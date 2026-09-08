//! Escalonador acelerado na GPU via ID3D11VideoProcessor.
//!
//! Realiza redimensionamento de alta qualidade e conversao de espaco de cor
//! BGRA -> NV12 em uma unica passada na GPU, substituindo o redimensionamento
//! em CPU com `rayon` e vizinho-mais-proximo.
//!
//! A textura de saida e mantida em formato `DXGI_FORMAT_NV12` na GPU, pronta
//! para ser consumida diretamente pelo encoder de hardware (Media Foundation MFT)
//! ou lida de volta para JPEG durante o fallback.

use std::mem::ManuallyDrop;

use crate::screen_sources::scale_to_fit;
use image::RgbaImage;
use windows::{
    Win32::{
        Foundation::{RECT, TRUE},
        Graphics::{
            Direct3D11::{
                D3D11_BIND_RENDER_TARGET, D3D11_BIND_VIDEO_ENCODER,
                D3D11_CPU_ACCESS_READ, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
                D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC,
                D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_STREAM,
                D3D11_VIDEO_USAGE_OPTIMAL_QUALITY, D3D11_VPOV_DIMENSION_TEXTURE2D,
                D3D11_VPIV_DIMENSION_TEXTURE2D, ID3D11Device, ID3D11DeviceContext, ID3D11Resource,
                ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
                ID3D11VideoProcessorEnumerator, ID3D11VideoProcessorOutputView,
            },
            Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_RATIONAL},
        },
    },
    core::Interface,
};

/// Calcula a resolucao de destino garantindo que largura e altura sejam
/// multiplos de 2 (obrigatorio para subamostragem de croma NV12 4:2:0).
pub fn calculate_aligned_destination(
    src_width: u32,
    src_height: u32,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    let (target_w, target_h) = scale_to_fit(src_width, src_height, max_width, max_height);
    let aligned_w = (target_w & !1).max(2);
    let aligned_h = (target_h & !1).max(2);
    (aligned_w, aligned_h)
}

pub struct D3D11VideoScaler {
    d3d_device: ID3D11Device,
    d3d_context: ID3D11DeviceContext,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    enumerator: ID3D11VideoProcessorEnumerator,
    output_texture: ID3D11Texture2D,
    output_view: ID3D11VideoProcessorOutputView,
    staging_texture: Option<ID3D11Texture2D>,
    input_width: u32,
    input_height: u32,
    output_width: u32,
    output_height: u32,
}

impl D3D11VideoScaler {
    pub fn new(
        d3d_device: &ID3D11Device,
        d3d_context: &ID3D11DeviceContext,
        input_width: u32,
        input_height: u32,
        output_width: u32,
        output_height: u32,
        fps: u32,
    ) -> Result<Self, String> {
        let video_device: ID3D11VideoDevice = d3d_device
            .cast()
            .map_err(|e| format!("dispositivo D3D11 nao suporta ID3D11VideoDevice: {e}"))?;
        let video_context: ID3D11VideoContext = d3d_context
            .cast()
            .map_err(|e| format!("contexto D3D11 nao suporta ID3D11VideoContext: {e}"))?;

        let (processor, enumerator, output_texture, output_view) = Self::create_resources(
            d3d_device,
            &video_device,
            input_width,
            input_height,
            output_width,
            output_height,
            fps,
        )?;

        Ok(Self {
            d3d_device: d3d_device.clone(),
            d3d_context: d3d_context.clone(),
            video_device,
            video_context,
            processor,
            enumerator,
            output_texture,
            output_view,
            staging_texture: None,
            input_width,
            input_height,
            output_width,
            output_height,
        })
    }

    fn create_resources(
        d3d_device: &ID3D11Device,
        video_device: &ID3D11VideoDevice,
        input_width: u32,
        input_height: u32,
        output_width: u32,
        output_height: u32,
        fps: u32,
    ) -> Result<
        (
            ID3D11VideoProcessor,
            ID3D11VideoProcessorEnumerator,
            ID3D11Texture2D,
            ID3D11VideoProcessorOutputView,
        ),
        String,
    > {
        let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL {
                Numerator: fps.max(1),
                Denominator: 1,
            },
            InputWidth: input_width,
            InputHeight: input_height,
            OutputFrameRate: DXGI_RATIONAL {
                Numerator: fps.max(1),
                Denominator: 1,
            },
            OutputWidth: output_width,
            OutputHeight: output_height,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_QUALITY,
        };

        let enumerator = unsafe {
            video_device
                .CreateVideoProcessorEnumerator(&content_desc)
                .map_err(|e| format!("falha ao criar VideoProcessorEnumerator: {e}"))?
        };

        let processor = unsafe {
            video_device
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(|e| format!("falha ao criar VideoProcessor: {e}"))?
        };

        // Textura NV12 de saida na GPU com D3D11_BIND_RENDER_TARGET | D3D11_BIND_VIDEO_ENCODER
        let output_desc = D3D11_TEXTURE2D_DESC {
            Width: output_width,
            Height: output_height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };

        let mut output_texture = None;
        unsafe {
            d3d_device
                .CreateTexture2D(&output_desc, None, Some(&mut output_texture))
                .map_err(|e| format!("falha ao criar textura NV12 de saida: {e}"))?;
        }
        let output_texture = output_texture.ok_or_else(|| "textura NV12 nula".to_string())?;

        let out_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: windows::Win32::Graphics::Direct3D11::D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };

        let mut output_view = None;
        unsafe {
            video_device
                .CreateVideoProcessorOutputView(
                    &output_texture,
                    &enumerator,
                    &out_view_desc,
                    Some(&mut output_view),
                )
                .map_err(|e| format!("falha ao criar VideoProcessorOutputView: {e}"))?;
        }
        let output_view = output_view.ok_or_else(|| "output view nulo".to_string())?;

        Ok((processor, enumerator, output_texture, output_view))
    }

    /// Executa escala e conversao de cor BGRA -> NV12 em GPU via VideoProcessorBlt.
    pub fn scale_nv12(
        &mut self,
        input_texture: &ID3D11Texture2D,
        src_width: u32,
        src_height: u32,
        dst_width: u32,
        dst_height: u32,
        fps: u32,
    ) -> Result<&ID3D11Texture2D, String> {
        if self.input_width != src_width
            || self.input_height != src_height
            || self.output_width != dst_width
            || self.output_height != dst_height
        {
            let (proc, r#enum, out_tex, out_view) = Self::create_resources(
                &self.d3d_device,
                &self.video_device,
                src_width,
                src_height,
                dst_width,
                dst_height,
                fps,
            )?;
            self.processor = proc;
            self.enumerator = r#enum;
            self.output_texture = out_tex;
            self.output_view = out_view;
            self.staging_texture = None;
            self.input_width = src_width;
            self.input_height = src_height;
            self.output_width = dst_width;
            self.output_height = dst_height;
        }

        let in_view_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: Default::default(),
        };

        let mut input_view = None;
        unsafe {
            self.video_device
                .CreateVideoProcessorInputView(
                    input_texture,
                    &self.enumerator,
                    &in_view_desc,
                    Some(&mut input_view),
                )
                .map_err(|e| format!("falha ao criar VideoProcessorInputView: {e}"))?;
        }
        let input_view = input_view.ok_or_else(|| "input view nulo".to_string())?;

        let target_rect = RECT {
            left: 0,
            top: 0,
            right: dst_width as i32,
            bottom: dst_height as i32,
        };
        let src_rect = RECT {
            left: 0,
            top: 0,
            right: src_width as i32,
            bottom: src_height as i32,
        };

        unsafe {
            self.video_context
                .VideoProcessorSetOutputTargetRect(&self.processor, true, Some(&target_rect));
            self.video_context
                .VideoProcessorSetStreamDestRect(&self.processor, 0, true, Some(&target_rect));
            self.video_context
                .VideoProcessorSetStreamSourceRect(&self.processor, 0, true, Some(&src_rect));
            self.video_context.VideoProcessorSetStreamFrameFormat(
                &self.processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
        }

        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: TRUE,
            OutputIndex: 0,
            InputFrameOrField: 0,
            PastFrames: 0,
            FutureFrames: 0,
            ppPastSurfaces: std::ptr::null_mut(),
            pInputSurface: ManuallyDrop::new(Some(input_view)),
            ppFutureSurfaces: std::ptr::null_mut(),
            ppPastSurfacesRight: std::ptr::null_mut(),
            pInputSurfaceRight: ManuallyDrop::new(None),
            ppFutureSurfacesRight: std::ptr::null_mut(),
        };

        unsafe {
            self.video_context
                .VideoProcessorBlt(
                    &self.processor,
                    &self.output_view,
                    0,
                    &[stream],
                )
                .map_err(|e| format!("falha no VideoProcessorBlt: {e}"))?;
        }

        Ok(&self.output_texture)
    }

    /// Retorna a textura de saida NV12 corrente na GPU.
    pub fn output_texture(&self) -> &ID3D11Texture2D {
        &self.output_texture
    }

    /// Faz readback da textura NV12 da GPU e converte para RgbaImage na CPU.
    /// Usado pelo pipeline JPEG ate a introducao do hardware encoder MFT no Prompt 4.
    pub fn read_to_rgba(&mut self) -> Result<RgbaImage, String> {
        let width = self.output_width;
        let height = self.output_height;

        if self.staging_texture.is_none() {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
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
                    .map_err(|e| format!("falha ao criar staging texture NV12: {e}"))?;
            }
            self.staging_texture = staging;
        }

        let staging = self
            .staging_texture
            .as_ref()
            .ok_or_else(|| "staging texture NV12 nula".to_string())?;

        unsafe {
            self.d3d_context.CopyResource(staging, &self.output_texture);
        }

        let resource: ID3D11Resource = staging
            .cast()
            .map_err(|e| format!("falha ao converter staging para ID3D11Resource: {e}"))?;

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
                .map_err(|e| format!("falha ao mapear staging texture NV12: {e}"))?;
        }

        let src_ptr = mapped.pData as *const u8;
        let row_pitch = mapped.RowPitch as usize;

        // Leitura NV12 -> RGBA:
        // Plano Y: height linhas de width bytes
        // Plano UV: height / 2 linhas de width bytes (pares U, V intercalados)
        let mut raw = vec![0u8; (width * height * 4) as usize];
        let uv_start = height as usize * row_pitch;

        for y in 0..height as usize {
            let y_row = unsafe { src_ptr.add(y * row_pitch) };
            let uv_row = unsafe { src_ptr.add(uv_start + (y / 2) * row_pitch) };
            let dst_row = &mut raw[y * width as usize * 4..(y + 1) * width as usize * 4];

            for x in 0..width as usize {
                let y_val = unsafe { *y_row.add(x) } as i32;
                let uv_idx = (x / 2) * 2;
                let u_val = unsafe { *uv_row.add(uv_idx) } as i32 - 128;
                let v_val = unsafe { *uv_row.add(uv_idx + 1) } as i32 - 128;

                // Conversao BT.601 inteira rapida com clamping
                let r = (y_val + ((359 * v_val) >> 8)).clamp(0, 255) as u8;
                let g = (y_val - ((88 * u_val + 183 * v_val) >> 8)).clamp(0, 255) as u8;
                let b = (y_val + ((454 * u_val) >> 8)).clamp(0, 255) as u8;

                let px = x * 4;
                dst_row[px] = r;
                dst_row[px + 1] = g;
                dst_row[px + 2] = b;
                dst_row[px + 3] = 255;
            }
        }

        unsafe {
            self.d3d_context.Unmap(Some(&resource), 0);
        }

        RgbaImage::from_raw(width, height, raw)
            .ok_or_else(|| "falha ao construir RgbaImage a partir de NV12".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
    };

    #[test]
    fn escalonador_d3d11_inicializa_e_aloca_recursos() {
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
            println!("D3D11 hardware nao disponivel no ambiente de teste");
            return;
        }
        let device = d3d_device.unwrap();
        let context = d3d_context.unwrap();

        let mut scaler = D3D11VideoScaler::new(&device, &context, 1920, 1080, 1280, 720, 60)
            .expect("Falha ao criar scaler");

        // Cria uma textura BGRA de entrada para testar VideoProcessorBlt
        let in_desc = D3D11_TEXTURE2D_DESC {
            Width: 1920,
            Height: 1080,
            MipLevels: 1,
            ArraySize: 1,
            Format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: windows::Win32::Graphics::Direct3D11::D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut input_texture = None;
        unsafe {
            device
                .CreateTexture2D(&in_desc, None, Some(&mut input_texture))
                .expect("Falha ao criar textura BGRA de entrada");
        }
        let input_texture = input_texture.unwrap();

        let res = scaler.scale_nv12(&input_texture, 1920, 1080, 1280, 720, 60);
        assert!(res.is_ok(), "Falha no scale_nv12: {:?}", res.err());

        let rgba = scaler.read_to_rgba();
        assert!(rgba.is_ok(), "Falha no read_to_rgba: {:?}", rgba.err());
        let img = rgba.unwrap();
        assert_eq!(img.dimensions(), (1280, 720));
    }
}
