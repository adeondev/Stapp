//! Sessao persistente de Windows Graphics Capture (WGC).
//!
//! Substitui o caminho legado GDI (`BitBlt`/`GetDIBits`) por captura nativa do
//! DWM com aceleracao por GPU (Direct3D 11).
//!
//! Invariantes:
//! 1. A sessao WGC e o pool de quadros sao criados **uma unica vez** no inicio da
//!    transmissao e duram ate o encerramento.
//! 2. O cursor do mouse e composto em hardware pela propria WGC
//!    (`SetIsCursorCaptureEnabled(true)`), eliminando o custo de `overlay_mouse_cursor`.
//! 3. A chegada de quadros e dirigida por evento `FrameArrived` (`CreateFreeThreaded`),
//!    eliminando o pacer com polling e sleep.
//! 4. Falhas de inicializacao ou sistemas sem suporte caem graciosamente no fallback GDI.

use std::{
    sync::mpsc::{Receiver, RecvTimeoutError, sync_channel},
    time::Duration,
};

use crate::screen_sources::SourceLocator;
use image::RgbaImage;
use windows::{
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11CreateDevice, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
                D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, ID3D11Device,
                ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
            },
            Dxgi::{Common::DXGI_FORMAT_B8G8R8A8_UNORM, IDXGIDevice},
            Gdi::HMONITOR,
        },
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
        },
    },
    core::{IInspectable, Interface, factory},
};

/// Verifica se a Windows Graphics Capture esta disponivel no ambiente atual.
///
/// Permite desabilitar forcadamente via variavel de ambiente `STAPP_FORCE_GDI_CAPTURE=1`
/// para testes deterministicos de regressao e fallback.
pub fn is_wgc_supported() -> bool {
    if std::env::var_os("STAPP_FORCE_GDI_CAPTURE").is_some() {
        log::info!("WGC desabilitada explicitamente via STAPP_FORCE_GDI_CAPTURE");
        return false;
    }
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

pub struct WgcSession {
    d3d_device: ID3D11Device,
    d3d_context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
    _item: GraphicsCaptureItem,
    frame_pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    notify_rx: Receiver<()>,
    current_size: SizeInt32,
    staging_texture: Option<(ID3D11Texture2D, u32, u32)>,
    closed: bool,
}

impl WgcSession {
    pub fn new(locator: SourceLocator) -> Result<Self, String> {
        if !is_wgc_supported() {
            return Err("Windows Graphics Capture nao e suportada neste sistema".to_string());
        }

        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("falha ao obter IGraphicsCaptureItemInterop: {e}"))?;

        let item: GraphicsCaptureItem = match locator {
            SourceLocator::Screen(id) => {
                let h_monitor = HMONITOR(id as i32 as isize as *mut std::ffi::c_void);
                unsafe { interop.CreateForMonitor::<GraphicsCaptureItem>(h_monitor) }
                    .map_err(|e| format!("falha ao criar GraphicsCaptureItem para monitor: {e}"))?
            }
            SourceLocator::Window(id) => {
                let hwnd = HWND(id as i32 as isize as *mut std::ffi::c_void);
                unsafe { interop.CreateForWindow::<GraphicsCaptureItem>(hwnd) }
                    .map_err(|e| format!("falha ao criar GraphicsCaptureItem para janela: {e}"))?
            }
        };

        let item_size = item
            .Size()
            .map_err(|e| format!("falha ao obter tamanho do alvo WGC: {e}"))?;

        if item_size.Width <= 0 || item_size.Height <= 0 {
            return Err("alvo WGC com dimensoes invalidas".to_string());
        }

        let mut d3d_device = None;
        let mut d3d_context = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut d3d_device),
                None,
                Some(&mut d3d_context),
            )
            .map_err(|e| format!("falha ao criar dispositivo D3D11 para WGC: {e}"))?;
        }

        let d3d_device = d3d_device.ok_or_else(|| "D3D11Device nulo".to_string())?;
        let d3d_context = d3d_context.ok_or_else(|| "D3D11DeviceContext nulo".to_string())?;

        let dxgi_device = d3d_device
            .cast::<IDXGIDevice>()
            .map_err(|e| format!("falha ao converter D3D11Device para IDXGIDevice: {e}"))?;

        let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }
            .map_err(|e| format!("falha ao criar Direct3DDevice WinRT: {e}"))?;
        let winrt_device = inspectable
            .cast::<IDirect3DDevice>()
            .map_err(|e| format!("falha ao fazer cast para IDirect3DDevice: {e}"))?;

        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            item_size,
        )
        .map_err(|e| format!("falha ao criar Direct3D11CaptureFramePool: {e}"))?;

        let (notify_tx, notify_rx) = sync_channel::<()>(1);

        frame_pool
            .FrameArrived(
                &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
                    move |_pool, _| {
                        let _ = notify_tx.try_send(());
                        Ok(())
                    },
                ),
            )
            .map_err(|e| format!("falha registrando evento FrameArrived: {e}"))?;

        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(|e| format!("falha ao criar GraphicsCaptureSession: {e}"))?;

        // Composicao nativa do cursor do mouse pela WGC (sem custo adicional em GDI).
        if let Err(e) = session.SetIsCursorCaptureEnabled(true) {
            log::debug!("SetIsCursorCaptureEnabled(true) nao suportado: {e}");
        }

        // Remocao da borda amarela (suportado no Windows 11 / Windows 10 2004+).
        if let Err(e) = session.SetIsBorderRequired(false) {
            log::debug!("SetIsBorderRequired(false) nao suportado: {e}");
        }

        session
            .StartCapture()
            .map_err(|e| format!("falha iniciando GraphicsCaptureSession: {e}"))?;

        Ok(Self {
            d3d_device,
            d3d_context,
            winrt_device,
            _item: item,
            frame_pool,
            session,
            notify_rx,
            current_size: item_size,
            staging_texture: None,
            closed: false,
        })
    }

    /// Aguarda o proximo quadro emitido pelo compositor da WGC.
    ///
    /// Retorna `Ok(Some(imagem))` quando um novo quadro chega, `Ok(None)` em caso de timeout
    /// (por exemplo tela estatica ou ausencia de redesenho), ou `Err(...)` se a sessao falhar.
    pub fn next_frame(&mut self, timeout: Duration) -> Result<Option<RgbaImage>, String> {
        if self.closed {
            return Err("sessao WGC encerrada".to_string());
        }

        match self.notify_rx.recv_timeout(timeout) {
            Ok(()) => {}
            Err(RecvTimeoutError::Timeout) => return Ok(None),
            Err(RecvTimeoutError::Disconnected) => {
                return Err("canal de notificacao WGC desconectado".to_string());
            }
        }

        let frame = match self.frame_pool.TryGetNextFrame() {
            Ok(f) => f,
            Err(e) => return Err(format!("falha ao obter proximo quadro WGC: {e}")),
        };

        let content_size = frame
            .ContentSize()
            .unwrap_or(self.current_size);

        if content_size.Width <= 0 || content_size.Height <= 0 {
            let _ = frame.Close();
            return Ok(None);
        }

        // Se o tamanho da janela mudou, recria o pool de quadros com a nova resolucao.
        if content_size.Width != self.current_size.Width
            || content_size.Height != self.current_size.Height
        {
            if let Err(e) = self.frame_pool.Recreate(
                &self.winrt_device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                content_size,
            ) {
                log::warn!("Recreate do pool de quadros falhou: {e}");
            }
            self.current_size = content_size;
        }

        let surface = frame
            .Surface()
            .map_err(|e| format!("falha obtendo Surface do quadro: {e}"))?;

        let access = surface
            .cast::<IDirect3DDxgiInterfaceAccess>()
            .map_err(|e| format!("falha acessando IDirect3DDxgiInterfaceAccess: {e}"))?;

        let source_texture = unsafe { access.GetInterface::<ID3D11Texture2D>() }
            .map_err(|e| format!("falha obtendo ID3D11Texture2D: {e}"))?;

        let width = content_size.Width as u32;
        let height = content_size.Height as u32;

        let staging = self.get_or_create_staging_texture(width, height)?;

        let box_region = D3D11_BOX {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            front: 0,
            back: 1,
        };

        unsafe {
            self.d3d_context.CopySubresourceRegion(
                Some(&staging.cast().map_err(|e| e.to_string())?),
                0,
                0,
                0,
                0,
                Some(&source_texture.cast().map_err(|e| e.to_string())?),
                0,
                Some(&box_region),
            );
        }

        let resource: ID3D11Resource = staging
            .cast()
            .map_err(|e| format!("falha convertendo staging para ID3D11Resource: {e}"))?;

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.d3d_context
                .Map(
                    Some(&resource),
                    0,
                    D3D11_MAP_READ,
                    0,
                    Some(&mut mapped),
                )
                .map_err(|e| format!("falha ao mapear staging texture: {e}"))?;
        }

        let mut raw = vec![0u8; (width * height * 4) as usize];
        let src_ptr = mapped.pData as *const u8;
        let row_pitch = mapped.RowPitch as usize;

        for y in 0..height as usize {
            let src_row = unsafe {
                std::slice::from_raw_parts(src_ptr.add(y * row_pitch), width as usize * 4)
            };
            let dst_offset = y * width as usize * 4;
            let dst_row = &mut raw[dst_offset..dst_offset + (width as usize * 4)];

            // Conversao BGRA -> RGBA e garantia de canal alfa opaco.
            for x in 0..width as usize {
                let px = x * 4;
                dst_row[px] = src_row[px + 2];     // R
                dst_row[px + 1] = src_row[px + 1]; // G
                dst_row[px + 2] = src_row[px];     // B
                dst_row[px + 3] = 255;            // A
            }
        }

        unsafe {
            self.d3d_context.Unmap(Some(&resource), 0);
        }

        let _ = frame.Close();

        let image = RgbaImage::from_raw(width, height, raw)
            .ok_or_else(|| "falha ao construir RgbaImage a partir do buffer WGC".to_string())?;

        Ok(Some(image))
    }

    fn get_or_create_staging_texture(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        if let Some((ref tex, w, h)) = self.staging_texture {
            if w == width && h == height {
                return Ok(tex.clone());
            }
        }

        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let mut staging = None;
        unsafe {
            self.d3d_device
                .CreateTexture2D(&desc, None, Some(&mut staging))
                .map_err(|e| format!("falha ao criar staging texture WGC: {e}"))?;
        }

        let staging = staging.ok_or_else(|| "staging texture nula".to_string())?;
        self.staging_texture = Some((staging.clone(), width, height));
        Ok(staging)
    }

    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        let _ = self.session.Close();
        let _ = self.frame_pool.Close();
        self.staging_texture = None;
    }
}

impl Drop for WgcSession {
    fn drop(&mut self) {
        self.close();
    }
}
