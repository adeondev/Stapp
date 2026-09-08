//! Codificador H.264 acelerado por hardware via Media Foundation Transform (MFT).
//!
//! Descobre e inicializa encoders de hardware (NVENC da NVIDIA, AMF da AMD,
//! QuickSync da Intel) que consomem diretamente a textura `ID3D11Texture2D`
//! em formato NV12 produzida pelo `D3D11VideoScaler`.

use std::sync::Once;
use windows::{
    core::Interface,
    Win32::{
        Graphics::Direct3D11::ID3D11Device,
        Media::MediaFoundation::{
            MFTEnumEx, MFStartup, MF_VERSION, MFSTARTUP_NOSOCKET,
            MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER,
            MFT_REGISTER_TYPE_INFO, MFMediaType_Video, MFVideoFormat_H264, MFVideoFormat_NV12,
            MFT_FRIENDLY_NAME_Attribute, IMFActivate, IMFTransform,
            IMFDXGIDeviceManager, MFCreateDXGIDeviceManager, MFCreateMediaType,
            MFT_MESSAGE_SET_D3D_MANAGER, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM,
            MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_MT_AVG_BITRATE, MF_MT_FRAME_SIZE,
            MF_MT_FRAME_RATE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_INTERLACE_MODE,
            MFVideoInterlace_Progressive, MF_TRANSFORM_ASYNC_UNLOCK, MF_SA_D3D11_AWARE,
        },
        System::Com::CoTaskMemFree,
    },
};

static MF_INIT: Once = Once::new();

/// Garante que a Media Foundation seja inicializada uma unica vez no processo.
pub fn ensure_mf_initialized() -> Result<(), String> {
    let mut init_res = Ok(());
    MF_INIT.call_once(|| {
        let hr = unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) };
        if hr.is_err() {
            init_res = Err(format!("falha ao inicializar Media Foundation (MFStartup): {hr:?}"));
        }
    });
    init_res
}

/// Identificador resumido do fabricante do encoder para telemetria e diagnostico.
pub fn vendor_from_friendly_name(friendly_name: &str) -> &'static str {
    let lower = friendly_name.to_lowercase();
    if lower.contains("nvidia") {
        "NVIDIA NVENC"
    } else if lower.contains("amd") || lower.contains("advanced micro devices") {
        "AMD AMF"
    } else if lower.contains("intel") {
        "Intel QuickSync"
    } else if lower.contains("qualcomm") {
        "Qualcomm Adreno"
    } else {
        "Hardware MFT"
    }
}

/// Descobre um encoder H.264 por hardware disponivel no sistema.
pub fn discover_hardware_h264_encoder() -> Result<Option<(IMFActivate, String)>, String> {
    ensure_mf_initialized()?;

    let input_type = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output_type = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };

    let flags = MFT_ENUM_FLAG(MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SORTANDFILTER.0);

    let mut activate_ptrs: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count: u32 = 0;

    let hr = unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input_type),
            Some(&output_type),
            &mut activate_ptrs,
            &mut count,
        )
    };

    if hr.is_err() || count == 0 || activate_ptrs.is_null() {
        return Ok(None);
    }

    // Pega o primeiro encoder ativado retornado pela ordenacao do sistema
    let activates: &[Option<IMFActivate>] = unsafe { std::slice::from_raw_parts(activate_ptrs, count as usize) };
    let first_activate = activates.iter().filter_map(|a| a.as_ref()).next().cloned();

    let result = if let Some(activate) = first_activate {
        let mut buffer = [0u16; 256];
        let mut name_len: u32 = 0;
        let name = unsafe {
            if activate.GetString(
                &MFT_FRIENDLY_NAME_Attribute,
                &mut buffer,
                Some(&mut name_len),
            ).is_ok() && name_len > 0 {
                String::from_utf16_lossy(&buffer[..name_len as usize])
            } else {
                "Hardware MFT".to_string()
            }
        };
        Some((activate, name))
    } else {
        None
    };

    unsafe {
        CoTaskMemFree(Some(activate_ptrs as *const _));
    }

    Ok(result)
}

#[inline]
fn pack_u32_pair(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

#[allow(dead_code)]
pub struct H264Encoder {
    mft: IMFTransform,
    dxgi_manager: IMFDXGIDeviceManager,
    vendor_name: &'static str,
    friendly_name: String,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
}

impl H264Encoder {
    pub fn new(
        d3d_device: &ID3D11Device,
        width: u32,
        height: u32,
        fps: u32,
        target_bitrate: u32,
    ) -> Result<Self, String> {
        let (activate, friendly_name) = discover_hardware_h264_encoder()?
            .ok_or_else(|| "nenhum encoder H.264 por hardware disponivel".to_string())?;

        let vendor_name = vendor_from_friendly_name(&friendly_name);

        let mft: IMFTransform = unsafe {
            activate
                .ActivateObject()
                .map_err(|e| format!("falha ao ativar IMFTransform: {e}"))?
        };

        // Desbloqueia MFT assincrono se exigido pelo hardware e habilita D3D11
        if let Ok(attributes) = unsafe { mft.GetAttributes() } {
            let _ = unsafe { attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1) };
            let _ = unsafe { attributes.SetUINT32(&MF_SA_D3D11_AWARE, 1) };
        }

        // Cria o gerenciador de dispositivo DXGI para compartilhar o D3D11Device com o MFT
        let mut reset_token = 0u32;
        let mut dxgi_manager: Option<IMFDXGIDeviceManager> = None;
        unsafe {
            MFCreateDXGIDeviceManager(&mut reset_token, &mut dxgi_manager)
                .map_err(|e| format!("falha ao criar MFCreateDXGIDeviceManager: {e}"))?;
        }
        let dxgi_manager = dxgi_manager.ok_or_else(|| "IMFDXGIDeviceManager nulo".to_string())?;

        unsafe {
            dxgi_manager
                .ResetDevice(d3d_device, reset_token)
                .map_err(|e| format!("falha ao associar ID3D11Device ao DXGIManager: {e}"))?;
        }

        // Informa o MFT para utilizar o acelerador DXGI / D3D11
        let unknown: windows::core::IUnknown = dxgi_manager.cast().map_err(|e| e.to_string())?;
        unsafe {
            let _ = mft.ProcessMessage(
                MFT_MESSAGE_SET_D3D_MANAGER,
                std::mem::transmute_copy(&unknown),
            );
        }

        // Configura o tipo de midia de saida (H.264)
        let output_type = unsafe {
            MFCreateMediaType()
                .map_err(|e| format!("falha ao criar IMFMediaType de saida: {e}"))?
        };

        unsafe {
            output_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| format!("falha ao definir MF_MT_MAJOR_TYPE de saida: {e}"))?;
            output_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
                .map_err(|e| format!("falha ao definir MF_MT_SUBTYPE de saida: {e}"))?;
            output_type
                .SetUINT32(&MF_MT_AVG_BITRATE, target_bitrate)
                .map_err(|e| format!("falha ao definir MF_MT_AVG_BITRATE de saida: {e}"))?;
            output_type
                .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
                .map_err(|e| format!("falha ao definir MF_MT_FRAME_SIZE de saida: {e}"))?;
            output_type
                .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps.max(1), 1))
                .map_err(|e| format!("falha ao definir MF_MT_FRAME_RATE de saida: {e}"))?;
            output_type
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
                .map_err(|e| format!("falha ao definir MF_MT_PIXEL_ASPECT_RATIO de saida: {e}"))?;
            output_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| format!("falha ao definir MF_MT_INTERLACE_MODE de saida: {e}"))?;

            mft.SetOutputType(0, &output_type, 0)
                .map_err(|e| format!("falha ao aplicar SetOutputType no encoder H.264: {e}"))?;
        }

        // Configura o tipo de midia de entrada (NV12 do D3D11VideoScaler)
        let input_type = unsafe {
            MFCreateMediaType()
                .map_err(|e| format!("falha ao criar IMFMediaType de entrada: {e}"))?
        };

        unsafe {
            input_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| format!("falha ao definir MF_MT_MAJOR_TYPE de entrada: {e}"))?;
            input_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                .map_err(|e| format!("falha ao definir MF_MT_SUBTYPE de entrada: {e}"))?;
            input_type
                .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
                .map_err(|e| format!("falha ao definir MF_MT_FRAME_SIZE de entrada: {e}"))?;
            input_type
                .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps.max(1), 1))
                .map_err(|e| format!("falha ao definir MF_MT_FRAME_RATE de entrada: {e}"))?;
            input_type
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
                .map_err(|e| format!("falha ao definir MF_MT_PIXEL_ASPECT_RATIO de entrada: {e}"))?;
            input_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| format!("falha ao definir MF_MT_INTERLACE_MODE de entrada: {e}"))?;

            mft.SetInputType(0, &input_type, 0)
                .map_err(|e| format!("falha ao aplicar SetInputType no encoder H.264: {e}"))?;
        }

        // Inicia o fluxo de streaming do encoder
        unsafe {
            let _ = mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
            let _ = mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        }

        log::info!(
            "Encoder H.264 por hardware inicializado: {friendly_name} ({vendor_name}), {width}x{height} @ {fps}fps, {target_bitrate} bps"
        );

        Ok(Self {
            mft,
            dxgi_manager,
            vendor_name,
            friendly_name,
            width,
            height,
            fps,
            bitrate: target_bitrate,
        })
    }

    pub fn vendor_name(&self) -> &'static str {
        self.vendor_name
    }

    pub fn friendly_name(&self) -> &str {
        &self.friendly_name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testa_descoberta_de_encoder_de_hardware() {
        let encoder = discover_hardware_h264_encoder().expect("falha ao consultar encoders");
        if let Some((_, name)) = encoder {
            let vendor = vendor_from_friendly_name(&name);
            eprintln!("\n>>> Encoder MFT de hardware detectado: '{name}' (fabricante: {vendor}) <<<\n");
        } else {
            eprintln!("\n>>> Nenhum encoder H.264 por hardware disponivel neste ambiente <<<\n");
        }
    }

    #[test]
    fn testa_inicializacao_do_encoder_h264_hardware() {
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
        };

        let mut d3d_device = None;
        let mut d3d_context = None;
        let hr = unsafe {
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
        };
        if hr.is_err() {
            return;
        }
        let device = d3d_device.unwrap();

        let encoder_res = H264Encoder::new(&device, 1280, 720, 60, 2_500_000);
        assert!(encoder_res.is_ok(), "falha inicializando encoder: {:?}", encoder_res.err());
        let encoder = encoder_res.unwrap();
        eprintln!(
            "\n>>> Encoder H.264 inicializado com sucesso: {} ({}) <<<\n",
            encoder.friendly_name(),
            encoder.vendor_name()
        );
        assert!(!encoder.friendly_name().is_empty());
        assert_eq!(encoder.width, 1280);
        assert_eq!(encoder.height, 720);
    }
}
