//! Codificador H.264 acelerado por hardware via Media Foundation Transform (MFT).
//!
//! Descobre e inicializa encoders de hardware (NVENC da NVIDIA, AMF da AMD,
//! QuickSync da Intel) que consomem diretamente a textura `ID3D11Texture2D`
//! em formato NV12 produzida pelo `D3D11VideoScaler`.

#[cfg(windows)]
use std::sync::Once;
#[cfg(windows)]
use windows::{
    core::Interface,
    Win32::{
        Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D},
        Media::MediaFoundation::{
            MFTEnumEx, MFCreateDXGISurfaceBuffer, MFCreateMediaType, MFCreateSample, MFCreateMemoryBuffer,
            MFStartup, MF_VERSION, MFSTARTUP_NOSOCKET, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG,
            MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO,
            MFMediaType_Video, MFVideoFormat_H264, MFVideoFormat_NV12, MFT_FRIENDLY_NAME_Attribute,
            IMFActivate, IMFTransform, IMFDXGIDeviceManager, MFCreateDXGIDeviceManager,
            MFT_MESSAGE_SET_D3D_MANAGER, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM,
            MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_MT_AVG_BITRATE, MF_MT_FRAME_SIZE,
            MF_MT_FRAME_RATE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_INTERLACE_MODE,
            MFVideoInterlace_Progressive, MF_TRANSFORM_ASYNC_UNLOCK, MF_SA_D3D11_AWARE,
            MFT_OUTPUT_DATA_BUFFER,
            MFSampleExtension_CleanPoint, MF_E_TRANSFORM_NEED_MORE_INPUT, MF_E_NOTACCEPTING,
            CODECAPI_AVEncCommonLowLatency,
            IMFMediaEventGenerator,
        },
        System::Com::CoTaskMemFree,
    },
};

pub const MAGIC_STAP: [u8; 4] = *b"STAP";
pub const HEADER_SIZE: usize = 32;
pub const CODEC_JPEG: u8 = 0;
pub const CODEC_H264: u8 = 1;
pub const FLAG_KEYFRAME: u8 = 1 << 0;

pub const MAGIC_SAUD: [u8; 4] = *b"SAUD";
pub const AUDIO_HEADER_SIZE: usize = 32;

/// Cabecalho de 32 bytes para pacotes de video transmitidos pelo canal binario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PacketHeader {
    pub magic: [u8; 4],
    pub version: u8,
    pub codec: u8,
    pub flags: u8,
    pub reserved: u8,
    pub capture_id: u32,
    pub width: u32,
    pub height: u32,
    pub sequence: u32,
    pub timestamp_us: u64,
}

impl PacketHeader {
    pub fn new(
        codec: u8,
        is_keyframe: bool,
        capture_id: u32,
        width: u32,
        height: u32,
        sequence: u32,
        timestamp_us: u64,
    ) -> Self {
        Self {
            magic: MAGIC_STAP,
            version: 1,
            codec,
            flags: if is_keyframe { FLAG_KEYFRAME } else { 0 },
            reserved: 0,
            capture_id,
            width,
            height,
            sequence,
            timestamp_us,
        }
    }

    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        let mut buf = [0u8; HEADER_SIZE];
        buf[0..4].copy_from_slice(&self.magic);
        buf[4] = self.version;
        buf[5] = self.codec;
        buf[6] = self.flags;
        buf[7] = self.reserved;
        buf[8..12].copy_from_slice(&self.capture_id.to_le_bytes());
        buf[12..16].copy_from_slice(&self.width.to_le_bytes());
        buf[16..20].copy_from_slice(&self.height.to_le_bytes());
        buf[20..24].copy_from_slice(&self.sequence.to_le_bytes());
        buf[24..32].copy_from_slice(&self.timestamp_us.to_le_bytes());
        buf
    }

    #[allow(dead_code)]
    pub fn parse(buf: &[u8]) -> Option<Self> {
        if buf.len() < HEADER_SIZE || &buf[0..4] != &MAGIC_STAP {
            return None;
        }
        let version = buf[4];
        if version != 1 {
            return None;
        }
        Some(Self {
            magic: MAGIC_STAP,
            version,
            codec: buf[5],
            flags: buf[6],
            reserved: buf[7],
            capture_id: u32::from_le_bytes(buf[8..12].try_into().unwrap()),
            width: u32::from_le_bytes(buf[12..16].try_into().unwrap()),
            height: u32::from_le_bytes(buf[16..20].try_into().unwrap()),
            sequence: u32::from_le_bytes(buf[20..24].try_into().unwrap()),
            timestamp_us: u64::from_le_bytes(buf[24..32].try_into().unwrap()),
        })
    }

    #[allow(dead_code)]
    #[inline]
    pub fn is_keyframe(&self) -> bool {
        (self.flags & FLAG_KEYFRAME) != 0
    }
}

/// Empacota dados de video precedidos pelo cabecalho padrao de 32 bytes do Stapp.
pub fn pack_frame(
    codec: u8,
    is_keyframe: bool,
    capture_id: u32,
    width: u32,
    height: u32,
    sequence: u32,
    timestamp_us: u64,
    payload: &[u8],
) -> Vec<u8> {
    let header = PacketHeader::new(
        codec,
        is_keyframe,
        capture_id,
        width,
        height,
        sequence,
        timestamp_us,
    );
    let mut packet = Vec::with_capacity(HEADER_SIZE + payload.len());
    packet.extend_from_slice(&header.to_bytes());
    packet.extend_from_slice(payload);
    packet
}

/// Cabecalho padrao de 32 bytes para pacotes de audio PCM transmitidos pelo canal binario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioPacketHeader {
    pub magic: [u8; 4],
    pub version: u8,
    pub channels: u8,
    pub flags: u8,
    pub reserved: u8,
    pub capture_id: u32,
    pub sample_rate: u32,
    pub sequence: u32,
    pub timestamp_us: u64,
}

impl AudioPacketHeader {
    pub fn new(
        capture_id: u32,
        sample_rate: u32,
        channels: u8,
        sequence: u32,
        timestamp_us: u64,
    ) -> Self {
        Self {
            magic: MAGIC_SAUD,
            version: 1,
            channels,
            flags: 0,
            reserved: 0,
            capture_id,
            sample_rate,
            sequence,
            timestamp_us,
        }
    }

    pub fn to_bytes(&self) -> [u8; AUDIO_HEADER_SIZE] {
        let mut buf = [0u8; AUDIO_HEADER_SIZE];
        buf[0..4].copy_from_slice(&self.magic);
        buf[4] = self.version;
        buf[5] = self.channels;
        buf[6] = self.flags;
        buf[7] = self.reserved;
        buf[8..12].copy_from_slice(&self.capture_id.to_le_bytes());
        buf[12..16].copy_from_slice(&self.sample_rate.to_le_bytes());
        buf[16..20].copy_from_slice(&self.sequence.to_le_bytes());
        buf[20..28].copy_from_slice(&self.timestamp_us.to_le_bytes());
        buf[28..32].copy_from_slice(&[0u8; 4]);
        buf
    }

    #[allow(dead_code)]
    pub fn parse(buf: &[u8]) -> Option<Self> {
        if buf.len() < AUDIO_HEADER_SIZE || &buf[0..4] != &MAGIC_SAUD {
            return None;
        }
        let version = buf[4];
        if version != 1 {
            return None;
        }
        Some(Self {
            magic: MAGIC_SAUD,
            version,
            channels: buf[5],
            flags: buf[6],
            reserved: buf[7],
            capture_id: u32::from_le_bytes(buf[8..12].try_into().unwrap()),
            sample_rate: u32::from_le_bytes(buf[12..16].try_into().unwrap()),
            sequence: u32::from_le_bytes(buf[16..20].try_into().unwrap()),
            timestamp_us: u64::from_le_bytes(buf[20..28].try_into().unwrap()),
        })
    }
}

/// Empacota dados de audio PCM precedidos pelo cabecalho padrao de 32 bytes do Stapp.
pub fn pack_audio_frame(
    capture_id: u32,
    sample_rate: u32,
    channels: u8,
    sequence: u32,
    timestamp_us: u64,
    payload: &[u8],
) -> Vec<u8> {
    let header = AudioPacketHeader::new(
        capture_id,
        sample_rate,
        channels,
        sequence,
        timestamp_us,
    );
    let mut packet = Vec::with_capacity(AUDIO_HEADER_SIZE + payload.len());
    packet.extend_from_slice(&header.to_bytes());
    packet.extend_from_slice(payload);
    packet
}


/// Localiza todos os NALUs em bitstream Annex B (com prefixos 00 00 01 ou 00 00 00 01).
/// Retorna tuplas `(offset_inicio_nal_com_prefixo, offset_fim_nal, nal_unit_type)`.
pub fn find_annex_b_nalus(data: &[u8]) -> Vec<(usize, usize, u8)> {
    let mut prefixes = Vec::new();
    let len = data.len();
    let mut i = 0;

    while i + 2 < len {
        if data[i] == 0 && data[i + 1] == 0 {
            if data[i + 2] == 1 {
                let start = if i > 0 && data[i - 1] == 0 { i - 1 } else { i };
                prefixes.push((start, i + 3));
                i += 3;
                continue;
            } else if i + 3 < len && data[i + 2] == 0 && data[i + 3] == 1 {
                prefixes.push((i, i + 4));
                i += 4;
                continue;
            }
        }
        i += 1;
    }

    let mut nalus = Vec::new();
    for idx in 0..prefixes.len() {
        let (nal_start, payload_start) = prefixes[idx];
        let nal_end = if idx + 1 < prefixes.len() {
            prefixes[idx + 1].0
        } else {
            len
        };
        if payload_start < len {
            let nal_type = data[payload_start] & 0x1F;
            nalus.push((nal_start, nal_end, nal_type));
        }
    }
    nalus
}

#[derive(Debug, Clone)]
pub struct EncodedPacket {
    pub is_keyframe: bool,
    pub data: Vec<u8>,
}

#[cfg(windows)]
static MF_INIT: Once = Once::new();

/// Garante que a Media Foundation seja inicializada uma unica vez no processo.
#[cfg(windows)]
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

/// Identifica a fabricante a partir do nome amigavel do encoder MFT de hardware.
#[cfg(windows)]
pub fn vendor_from_friendly_name(friendly_name: &str) -> &'static str {
    let lower = friendly_name.to_lowercase();
    if lower.contains("nvidia") || lower.contains("nvenc") {
        "NVIDIA NVENC"
    } else if lower.contains("amd") || lower.contains("amf") {
        "AMD AMF"
    } else if lower.contains("intel") || lower.contains("quicksync") || lower.contains("qsv") {
        "Intel QuickSync"
    } else if lower.contains("qualcomm") {
        "Qualcomm"
    } else {
        "Hardware MFT"
    }
}

/// Descobre o primeiro encoder H.264 acelerado por hardware registrado no sistema.
#[cfg(windows)]
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

    let activates: &[Option<IMFActivate>] = unsafe { std::slice::from_raw_parts(activate_ptrs, count as usize) };
    let first_activate = activates.iter().filter_map(|a| a.as_ref()).next().cloned();

    let result = if let Some(activate) = first_activate {
        let mut buffer = [0u16; 256];
        let mut name_len: u32 = 0;
        let name = unsafe {
            if activate
                .GetString(
                    &MFT_FRIENDLY_NAME_Attribute,
                    &mut buffer,
                    Some(&mut name_len),
                )
                .is_ok()
                && name_len > 0
            {
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

#[cfg(windows)]
#[inline]
fn pack_u32_pair(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

#[cfg(windows)]
pub struct H264Encoder {
    mft: IMFTransform,
    event_gen: Option<IMFMediaEventGenerator>,
    #[allow(dead_code)]
    dxgi_manager: IMFDXGIDeviceManager,
    vendor_name: &'static str,
    friendly_name: String,
    width: u32,
    height: u32,
    fps: u32,
    #[allow(dead_code)]
    bitrate: u32,
    frame_index: u64,
    cached_sps: Option<Vec<u8>>,
    cached_pps: Option<Vec<u8>>,
    force_keyframe_next: bool,
}

#[cfg(windows)]
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
            let _ = unsafe { attributes.SetUINT32(&CODECAPI_AVEncCommonLowLatency, 1) };
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

        let event_gen: Option<IMFMediaEventGenerator> = mft.cast().ok();

        Ok(Self {
            mft,
            event_gen,
            dxgi_manager,
            vendor_name,
            friendly_name,
            width,
            height,
            fps,
            bitrate: target_bitrate,
            frame_index: 0,
            cached_sps: None,
            cached_pps: None,
            force_keyframe_next: true, // Primeiro quadro deve ser keyframe
        })
    }

    pub fn vendor_name(&self) -> &'static str {
        self.vendor_name
    }

    pub fn friendly_name(&self) -> &str {
        &self.friendly_name
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    #[allow(dead_code)]
    pub fn fps(&self) -> u32 {
        self.fps
    }

    #[allow(dead_code)]
    pub fn bitrate(&self) -> u32 {
        self.bitrate
    }

    /// Solicita que o proximo quadro codificado seja um IDR frame (keyframe).
    #[allow(dead_code)]
    pub fn request_keyframe(&mut self) {
        self.force_keyframe_next = true;
    }

    /// Codifica uma textura NV12 da GPU e produz os pacotes H.264 prontos.
    pub fn encode_texture(
        &mut self,
        texture: &ID3D11Texture2D,
        force_keyframe: bool,
    ) -> Result<Vec<EncodedPacket>, String> {
        let mut packets = self.drain_output()?;

        let buffer = unsafe {
            MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false)
                .map_err(|e| format!("falha criando DXGI surface buffer: {e}"))?
        };

        let sample = unsafe {
            MFCreateSample().map_err(|e| format!("falha criando IMFSample: {e}"))?
        };
        unsafe {
            sample
                .AddBuffer(&buffer)
                .map_err(|e| format!("falha adicionando buffer ao sample: {e}"))?;
        }

        let fps = self.fps.max(1) as u64;
        let duration_100ns = 10_000_000u64 / fps;
        let sample_time_100ns = self.frame_index * duration_100ns;
        self.frame_index += 1;

        unsafe {
            sample
                .SetSampleTime(sample_time_100ns as i64)
                .map_err(|e| format!("falha definindo sample time: {e}"))?;
            sample
                .SetSampleDuration(duration_100ns as i64)
                .map_err(|e| format!("falha definindo sample duration: {e}"))?;
            if force_keyframe || self.force_keyframe_next {
                let _ = sample.SetUINT32(&MFSampleExtension_CleanPoint, 1);
                self.force_keyframe_next = false;
            }
        }

        let input_res = unsafe { self.mft.ProcessInput(0, &sample, 0) };
        if let Err(e) = &input_res {
            if e.code() == MF_E_NOTACCEPTING {
                let drained = self.drain_output()?;
                packets.extend(drained);
                unsafe {
                    self.mft
                        .ProcessInput(0, &sample, 0)
                        .map_err(|e| format!("falha no ProcessInput apos drain: {e}"))?;
                }
            } else {
                return Err(format!("falha no ProcessInput do encoder H.264: {e}"));
            }
        }

        let drained = self.drain_output()?;
        packets.extend(drained);
        Ok(packets)
    }

    fn read_output_sample(&mut self) -> Result<Option<EncodedPacket>, String> {
        let stream_info = unsafe {
            self.mft
                .GetOutputStreamInfo(0)
                .map_err(|e| format!("falha GetOutputStreamInfo: {e}"))?
        };

        let s = unsafe {
            MFCreateSample().map_err(|e| format!("falha criando sample de saida: {e}"))?
        };
        let b = unsafe {
            MFCreateMemoryBuffer(stream_info.cbSize.max(1024 * 1024))
                .map_err(|e| format!("falha criando memory buffer de saida: {e}"))?
        };
        unsafe {
            s.AddBuffer(&b)
                .map_err(|e| format!("falha anexando buffer ao sample de saida: {e}"))?;
        }

        let mut out_buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: std::mem::ManuallyDrop::new(Some(s)),
            dwStatus: 0,
            pEvents: std::mem::ManuallyDrop::new(None),
        };
        let mut status = 0u32;
        let res = unsafe {
            self.mft
                .ProcessOutput(0, std::slice::from_mut(&mut out_buffer), &mut status)
        };

        let out_sample = std::mem::ManuallyDrop::into_inner(out_buffer.pSample);
        let _ = std::mem::ManuallyDrop::into_inner(out_buffer.pEvents);

        if let Err(e) = res {
            if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(format!("falha no ProcessOutput do encoder H.264: {e}"));
        }

        if let Some(sample) = out_sample {
            let contig = unsafe {
                sample
                    .ConvertToContiguousBuffer()
                    .map_err(|e| format!("falha ConvertToContiguousBuffer: {e}"))?
            };
            let mut ptr: *mut u8 = std::ptr::null_mut();
            let mut cur_len = 0u32;
            let mut max_len = 0u32;
            unsafe {
                contig
                    .Lock(&mut ptr, Some(&mut max_len), Some(&mut cur_len))
                    .map_err(|e| format!("falha ao travar buffer de saida: {e}"))?;
            }
            let raw_data =
                unsafe { std::slice::from_raw_parts(ptr, cur_len as usize).to_vec() };
            unsafe {
                let _ = contig.Unlock();
            }

            if raw_data.is_empty() {
                return Ok(None);
            }

            let nalus = find_annex_b_nalus(&raw_data);
            let mut has_sps = false;
            let mut has_pps = false;
            let mut has_idr = false;

            for &(start, end, nalu_type) in &nalus {
                if nalu_type == 7 {
                    has_sps = true;
                    self.cached_sps = Some(raw_data[start..end].to_vec());
                } else if nalu_type == 8 {
                    has_pps = true;
                    self.cached_pps = Some(raw_data[start..end].to_vec());
                } else if nalu_type == 5 {
                    has_idr = true;
                }
            }

            let is_clean_point = unsafe {
                sample
                    .GetUINT32(&MFSampleExtension_CleanPoint)
                    .unwrap_or(0)
                    == 1
            };
            let is_keyframe = has_idr || is_clean_point;

            let payload = if is_keyframe && (!has_sps || !has_pps) {
                if let (Some(sps), Some(pps)) = (&self.cached_sps, &self.cached_pps) {
                    let mut full =
                        Vec::with_capacity(sps.len() + pps.len() + raw_data.len());
                    if !has_sps {
                        full.extend_from_slice(sps);
                    }
                    if !has_pps {
                        full.extend_from_slice(pps);
                    }
                    full.extend_from_slice(&raw_data);
                    full
                } else {
                    raw_data
                }
            } else {
                raw_data
            };

            Ok(Some(EncodedPacket {
                is_keyframe,
                data: payload,
            }))
        } else {
            Ok(None)
        }
    }

    /// Drena amostras codificadas do MFT e garante que keyframes tenham SPS/PPS anexados.
    fn drain_output(&mut self) -> Result<Vec<EncodedPacket>, String> {
        let mut packets = Vec::new();
        let event_gen = self.event_gen.clone();
        if let Some(event_gen) = event_gen {
            let no_wait = windows::Win32::Media::MediaFoundation::MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(1);
            while let Ok(ev) = unsafe { event_gen.GetEvent(no_wait) } {
                let ev_type = unsafe { ev.GetType().unwrap_or_default() };
                if ev_type == 602 { // METransformHaveOutput
                    if let Some(p) = self.read_output_sample()? {
                        packets.push(p);
                    }
                }
            }
        } else {
            loop {
                match self.read_output_sample() {
                    Ok(Some(packet)) => packets.push(packet),
                    Ok(None) => break,
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(packets)
    }

    /// Forca a drenagem completa de qualquer quadro em fila no encoder.
    #[allow(dead_code)]
    pub fn drain_all(&mut self) -> Result<Vec<EncodedPacket>, String> {
        let _ = unsafe {
            self.mft.ProcessMessage(
                windows::Win32::Media::MediaFoundation::MFT_MESSAGE_COMMAND_DRAIN,
                0,
            )
        };
        let mut packets = Vec::new();
        let event_gen = self.event_gen.clone();
        if let Some(event_gen) = event_gen {
            loop {
                let ev = match unsafe {
                    event_gen.GetEvent(
                        windows::Win32::Media::MediaFoundation::MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0),
                    )
                } {
                    Ok(e) => e,
                    Err(_) => break,
                };
                let ev_type = unsafe { ev.GetType().unwrap_or_default() };
                if ev_type == 602 { // METransformHaveOutput
                    if let Some(p) = self.read_output_sample()? {
                        packets.push(p);
                    }
                } else if ev_type == 603 { // METransformDrainComplete
                    break;
                }
            }
        } else {
            packets.extend(self.drain_output()?);
        }
        Ok(packets)
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
    fn testa_pacotes_e_cabecalho_stap() {
        let payload = b"payload de teste para bitstream h264";
        let packet = pack_frame(
            CODEC_H264,
            true,
            42,
            1920,
            1080,
            1,
            123_456_789,
            payload,
        );
        assert_eq!(packet.len(), HEADER_SIZE + payload.len());

        let header = PacketHeader::parse(&packet).expect("falha no parse do cabecalho STAP");
        assert_eq!(header.magic, MAGIC_STAP);
        assert_eq!(header.version, 1);
        assert_eq!(header.codec, CODEC_H264);
        assert!(header.is_keyframe());
        assert_eq!(header.capture_id, 42);
        assert_eq!(header.width, 1920);
        assert_eq!(header.height, 1080);
        assert_eq!(header.sequence, 1);
        assert_eq!(header.timestamp_us, 123_456_789);
        assert_eq!(&packet[HEADER_SIZE..], payload);
    }

    #[test]
    fn testa_analisador_annex_b_e_anexacao_sps_pps() {
        // Simula bitstream Annex B com SPS (7), PPS (8) e IDR (5)
        let sps_nal = [0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x1f];
        let pps_nal = [0x00, 0x00, 0x00, 0x01, 0x68, 0xce, 0x38, 0x80];
        let idr_nal = [0x00, 0x00, 0x00, 0x01, 0x65, 0xb8, 0x00, 0x04];
        let p_nal = [0x00, 0x00, 0x01, 0x61, 0x9a]; // 3-byte start code

        let mut stream = Vec::new();
        stream.extend_from_slice(&sps_nal);
        stream.extend_from_slice(&pps_nal);
        stream.extend_from_slice(&idr_nal);
        stream.extend_from_slice(&p_nal);

        let nalus = find_annex_b_nalus(&stream);
        assert_eq!(nalus.len(), 4);
        assert_eq!(nalus[0].2, 7); // SPS
        assert_eq!(nalus[1].2, 8); // PPS
        assert_eq!(nalus[2].2, 5); // IDR
        assert_eq!(nalus[3].2, 1); // Non-IDR P-frame

        assert_eq!(&stream[nalus[0].0..nalus[0].1], &sps_nal);
        assert_eq!(&stream[nalus[1].0..nalus[1].1], &pps_nal);
        assert_eq!(&stream[nalus[2].0..nalus[2].1], &idr_nal);
        assert_eq!(&stream[nalus[3].0..nalus[3].1], &p_nal);
    }

    #[cfg(windows)]
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

    #[cfg(windows)]
    #[test]
    fn testa_codificacao_de_textura_d3d11_hardware() {
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
            D3D11_USAGE_DEFAULT,
        };
        use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};

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

        let mut encoder = match H264Encoder::new(&device, 1280, 720, 60, 2_500_000) {
            Ok(enc) => enc,
            Err(_) => return,
        };

        // Cria uma textura NV12 compativel com o pipeline de video
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 1280,
            Height: 720,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };

        let mut texture = None;
        let tex_hr = unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) };
        assert!(tex_hr.is_ok(), "falha criando textura NV12: {:?}", tex_hr.err());
        let texture = texture.unwrap();

        let mut total_packets = Vec::new();
        for _ in 0..3 {
            let packets = encoder.encode_texture(&texture, false).expect("falha ao codificar textura");
            total_packets.extend(packets);
        }
        let flushed = encoder.drain_all().expect("falha no drain_all");
        total_packets.extend(flushed);

        eprintln!("\n>>> Pacotes gerados pelo hardware encoder: {} <<<\n", total_packets.len());
        assert!(!total_packets.is_empty(), "hardware encoder deve produzir pacotes");
        assert!(total_packets.iter().any(|p| p.is_keyframe), "ao menos um pacote deve ser keyframe");

        // Verifica que o primeiro keyframe possui SPS e PPS anexados
        let keyframe = total_packets.iter().find(|p| p.is_keyframe).unwrap();
        let nalus = find_annex_b_nalus(&keyframe.data);
        assert!(nalus.iter().any(|n| n.2 == 7), "keyframe deve conter SPS (NAL 7)");
        assert!(nalus.iter().any(|n| n.2 == 8), "keyframe deve conter PPS (NAL 8)");
        assert!(nalus.iter().any(|n| n.2 == 5), "keyframe deve conter IDR slice (NAL 5)");
    }

    #[test]
    fn testa_validacao_de_cabecalhos_stap_corrompidos_ou_truncados() {
        // Pacote menor que HEADER_SIZE (32 bytes)
        let curto = vec![0u8; 31];
        assert!(PacketHeader::parse(&curto).is_none());
        assert!(PacketHeader::parse(&[]).is_none());

        // Pacote com magic invalido
        let mut invalido = pack_frame(CODEC_H264, true, 1, 1920, 1080, 1, 100, b"teste");
        invalido[0] = b'X';
        assert!(PacketHeader::parse(&invalido).is_none());

        // Pacote com versao nao suportada (versao 99)
        let mut versao_invalida = pack_frame(CODEC_H264, true, 1, 1920, 1080, 1, 100, b"teste");
        versao_invalida[4] = 99;
        assert!(PacketHeader::parse(&versao_invalida).is_none());

        // Pacote com sequence wrapping (u32::MAX) e flag delta (nao-keyframe)
        let seq_max = pack_frame(
            CODEC_JPEG,
            false,
            999,
            3840,
            2160,
            u32::MAX,
            u64::MAX,
            b"imagem jpeg delta",
        );
        let parsed = PacketHeader::parse(&seq_max).expect("deve aceitar sequencia u32::MAX");
        assert_eq!(parsed.codec, CODEC_JPEG);
        assert!(!parsed.is_keyframe());
        assert_eq!(parsed.sequence, u32::MAX);
        assert_eq!(parsed.timestamp_us, u64::MAX);
        assert_eq!(parsed.width, 3840);
        assert_eq!(parsed.height, 2160);
        assert_eq!(&seq_max[HEADER_SIZE..], b"imagem jpeg delta");
    }

    #[test]
    fn testa_analisador_annex_b_casos_complexos() {
        // Stream vazio
        assert!(find_annex_b_nalus(&[]).is_empty());

        // Stream sem nenhum start code
        assert!(find_annex_b_nalus(&[1, 2, 3, 4, 5, 6, 7, 8]).is_empty());

        // Stream com start codes mistos de 3 bytes (0x000001) e 4 bytes (0x00000001)
        let sei_nal = [0x00, 0x00, 0x01, 0x06, 0x05, 0xff]; // SEI (6)
        let sps_nal = [0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28]; // SPS (7)
        let pps_nal = [0x00, 0x00, 0x00, 0x01, 0x68, 0xee, 0x3c, 0x80]; // PPS (8)
        let non_idr = [0x00, 0x00, 0x01, 0x41, 0x9a, 0x01]; // Slice nao-IDR (1)

        let mut stream = Vec::new();
        stream.extend_from_slice(&sei_nal);
        stream.extend_from_slice(&sps_nal);
        stream.extend_from_slice(&pps_nal);
        stream.extend_from_slice(&non_idr);

        let nalus = find_annex_b_nalus(&stream);
        assert_eq!(nalus.len(), 4);
        assert_eq!(nalus[0].2, 6); // SEI
        assert_eq!(nalus[1].2, 7); // SPS
        assert_eq!(nalus[2].2, 8); // PPS
        assert_eq!(nalus[3].2, 1); // Non-IDR Slice

        assert_eq!(&stream[nalus[0].0..nalus[0].1], &sei_nal);
        assert_eq!(&stream[nalus[1].0..nalus[1].1], &sps_nal);
        assert_eq!(&stream[nalus[2].0..nalus[2].1], &pps_nal);
        assert_eq!(&stream[nalus[3].0..nalus[3].1], &non_idr);
    }

    #[cfg(windows)]
    #[test]
    fn testa_negociacao_e_keyframe_sob_demanda_no_encoder() {
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
            D3D11_USAGE_DEFAULT,
        };
        use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};

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

        let mut encoder = match H264Encoder::new(&device, 1280, 720, 30, 2_000_000) {
            Ok(enc) => enc,
            Err(_) => return,
        };

        // Verifica propriedades negociadas
        assert_eq!(encoder.width(), 1280);
        assert_eq!(encoder.height(), 720);
        assert_eq!(encoder.fps(), 30);
        assert_eq!(encoder.bitrate(), 2_000_000);
        assert!(!encoder.vendor_name().is_empty());
        assert!(!encoder.friendly_name().is_empty());

        // Verifica que solicitacao de keyframe ativa o indicador
        encoder.request_keyframe();
        assert!(encoder.force_keyframe_next);

        let desc = D3D11_TEXTURE2D_DESC {
            Width: 1280,
            Height: 720,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };

        let mut texture = None;
        let tex_hr = unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) };
        assert!(tex_hr.is_ok());
        let texture = texture.unwrap();

        // Codifica solicitando keyframe explicitamente
        let packets = encoder.encode_texture(&texture, true).expect("falha codificando textura com keyframe");
        let flushed = encoder.drain_all().expect("falha no drain");
        let all_packets: Vec<_> = packets.into_iter().chain(flushed.into_iter()).collect();

        if let Some(kf) = all_packets.iter().find(|p| p.is_keyframe) {
            let nalus = find_annex_b_nalus(&kf.data);
            assert!(nalus.iter().any(|n| n.2 == 7), "keyframe sob demanda deve ter SPS");
            assert!(nalus.iter().any(|n| n.2 == 8), "keyframe sob demanda deve ter PPS");
        }
    }
}
