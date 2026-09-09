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
        Capture::{
            Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind,
            GraphicsCaptureItem, GraphicsCaptureSession,
        },
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
    pub width: u32,
    pub height: u32,
    pub capture_duration: Duration,
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

/// Pede ao Windows o acesso "Borderless" da captura, uma unica vez por processo.
///
/// A borda amarela em volta do que esta sendo capturado e desenhada pelo proprio
/// Windows. `SetIsBorderRequired(false)` sozinho NAO basta: medido nesta maquina
/// (Windows 11 25H2, build 26200) o setter retorna `Ok` e o `IsBorderRequired` le
/// `false` de volta mesmo sem nenhum acesso concedido — ou seja, ele nunca
/// denunciou o problema. O que falta e a capacidade em si, que para um app
/// desktop nao empacotado se obtem por `RequestAccessAsync(Borderless)`.
///
/// PROTOTYPE: o resultado e apenas registrado, nunca fatal. Sem a concessao a
/// transmissao continua funcionando; o que muda e a borda ficar na tela de quem
/// compartilha. Invariante: isto jamais pode impedir uma captura de comecar.
///
/// FUTURE: se algum dia o app for empacotado (MSIX), a via passa a ser a
/// capacidade restrita `graphicsCaptureWithoutBorder` no manifesto, e esta
/// chamada vira redundante.
fn garantir_acesso_sem_borda() {
    static ACESSO: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    ACESSO.get_or_init(|| {
        let operacao =
            match GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless) {
                Ok(operacao) => operacao,
                Err(e) => {
                    log::warn!("RequestAccessAsync(Borderless) nao pode ser chamada: {e}");
                    return;
                }
            };

        // A operacao resolve na hora nesta maquina, mas o contrato e assincrono.
        // Espera limitada: a captura nao pode ficar refem de uma permissao.
        for _ in 0..50 {
            if let Ok(status) = operacao.GetResults() {
                log::info!("acesso Borderless da WGC: {status:?} (4 = Allowed)");
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        log::warn!("acesso Borderless da WGC nao respondeu em 1s; a borda amarela pode aparecer");
    });
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

        // Remocao da borda amarela que o Windows desenha em volta do alvo capturado.
        // A ordem importa: a capacidade tem que estar concedida antes de a propriedade
        // valer. O setter sozinho sempre respondeu Ok, e por isso o problema passou
        // despercebido — nunca houve erro para logar.
        garantir_acesso_sem_borda();
        if let Err(e) = session.SetIsBorderRequired(false) {
            log::warn!("SetIsBorderRequired(false) recusado: {e}");
        } else {
            log::info!(
                "borda da captura desligada (IsBorderRequired={:?})",
                session.IsBorderRequired(),
            );
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

        let capture_timer = std::time::Instant::now();
        let surface = frame
            .Surface()
            .map_err(|e| format!("falha obtendo Surface do quadro: {e}"))?;

        let access = surface
            .cast::<IDirect3DDxgiInterfaceAccess>()
            .map_err(|e| format!("falha acessando IDirect3DDxgiInterfaceAccess: {e}"))?;

        let source_texture = unsafe { access.GetInterface::<ID3D11Texture2D>() }
            .map_err(|e| format!("falha obtendo ID3D11Texture2D: {e}"))?;
        let capture_duration = capture_timer.elapsed();

        let width = content_size.Width as u32;
        let height = content_size.Height as u32;

        let (target_width, target_height) =
            super::scaler::calculate_aligned_destination(width, height, max_width, max_height);

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
        let _ = scaler
            .scale_nv12(&source_texture, width, height, target_width, target_height, fps)?;
        let resize_duration = timer.elapsed();
        let nv12_texture = scaler.output_texture().clone();
        let _ = frame.Close();

        Ok(Some(ScaledWgcFrame {
            width: target_width,
            height: target_height,
            capture_duration,
            resize_duration,
            nv12_texture,
        }))
    }

    pub fn d3d_device(&self) -> &ID3D11Device {
        &self.d3d_device
    }

    /// Faz o readback da textura escalonada para RGBA na CPU, usado exclusivamente como fallback
    /// quando o encoder H.264 por hardware nao esta disponivel.
    pub fn read_to_rgba(&mut self) -> Result<RgbaImage, String> {
        if let Some(scaler) = &mut self.scaler {
            scaler.read_to_rgba()
        } else {
            Err("escalonador D3D11 nao inicializado".to_string())
        }
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
