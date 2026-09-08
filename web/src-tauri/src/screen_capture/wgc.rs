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

use crate::screen_sources::{SourceLocator, scale_to_fit};
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
                D3D11CreateDevice, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                D3D11_SDK_VERSION, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
                ID3D11VideoDevice,
            },
            Dxgi::IDXGIDevice,
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

/// Quadro capturado por WGC e escalonado em GPU com conversao para NV12.
#[derive(Clone)]
pub struct ScaledWgcFrame {
    pub image: RgbaImage,
    pub width: u32,
    pub height: u32,
    pub resize_duration: Duration,
    pub nv12_texture: ID3D11Texture2D,
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
    scaler: Option<super::scaler::D3D11VideoScaler>,
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

        // Garante suporte ao pipeline de processamento de video D3D11
        let _video_device: ID3D11VideoDevice = d3d_device
            .cast()
            .map_err(|e| format!("dispositivo D3D11 nao suporta ID3D11VideoDevice: {e}"))?;

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
            scaler: None,
            closed: false,
        })
    }

    /// Aguarda o proximo quadro emitido pelo compositor da WGC e realiza escala
    /// e conversao de cor na GPU via `ID3D11VideoProcessor`.
    ///
    /// Retorna `Ok(Some(frame))` quando um novo quadro chega e e escalonado,
    /// `Ok(None)` em caso de timeout (por exemplo tela estatica), ou `Err(...)`.
    pub fn next_frame(
        &mut self,
        timeout: Duration,
        max_width: u32,
        max_height: u32,
        fps: u32,
    ) -> Result<Option<ScaledWgcFrame>, String> {
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

        let (target_width, target_height) = scale_to_fit(width, height, max_width, max_height);

        if self.scaler.is_none() {
            let scaler = super::scaler::D3D11VideoScaler::new(
                &self.d3d_device,
                &self.d3d_context,
                width,
                height,
                target_width,
                target_height,
                fps,
            )?;
            self.scaler = Some(scaler);
        }

        let scaler = self.scaler.as_mut().unwrap();

        let timer = std::time::Instant::now();
        let nv12_texture = scaler
            .scale_nv12(&source_texture, width, height, target_width, target_height, fps)?
            .clone();
        let resize_duration = timer.elapsed();

        let image = scaler.read_to_rgba()?;
        let _ = frame.Close();

        Ok(Some(ScaledWgcFrame {
            image,
            width: target_width,
            height: target_height,
            resize_duration,
            nv12_texture,
        }))
    }

    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        let _ = self.session.Close();
        let _ = self.frame_pool.Close();
        self.scaler = None;
    }
}

impl Drop for WgcSession {
    fn drop(&mut self) {
        self.close();
    }
}
