use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[cfg(feature = "s3")]
use {
    crate::config::S3Config,
    aws_config::BehaviorVersion,
    aws_credential_types::Credentials,
    aws_sdk_s3::{Client as S3Client, config::Region, presigning::PresigningConfig},
    base64::{Engine, engine::general_purpose::STANDARD},
    std::time::Duration,
};

#[derive(Clone)]
pub struct MediaStorageService {
    temporary_root: PathBuf,
    backend: Backend,
}

#[derive(Clone)]
enum Backend {
    Local {
        root: PathBuf,
    },
    #[cfg(feature = "s3")]
    S3 {
        client: S3Client,
        bucket: String,
    },
}

pub struct PresignedUpload {
    pub attachment_id: String,
    pub upload_url: String,
    pub s3_key: String,
}

impl MediaStorageService {
    pub fn local(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(root.join(".uploading"))
            .with_context(|| format!("nao consegui criar {}", root.display()))?;
        std::fs::create_dir_all(root.join("objects"))
            .with_context(|| format!("nao consegui criar {}", root.display()))?;
        Ok(Self {
            temporary_root: root.join(".uploading"),
            backend: Backend::Local { root },
        })
    }

    #[cfg(feature = "s3")]
    pub fn s3(cfg: &S3Config, temporary_root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&temporary_root)?;
        let creds = Credentials::new(&cfg.access_key, &cfg.secret_key, None, None, "stapp-manual");
        let s3_config = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(cfg.region.clone()))
            .endpoint_url(cfg.endpoint.clone())
            .credentials_provider(creds)
            .force_path_style(true)
            .sleep_impl(aws_smithy_async::rt::sleep::TokioSleep::new())
            .build();
        Ok(Self {
            temporary_root,
            backend: Backend::S3 {
                client: S3Client::from_conf(s3_config),
                bucket: cfg.bucket.clone(),
            },
        })
    }

    pub fn backend_name(&self) -> &'static str {
        match self.backend {
            Backend::Local { .. } => "local",
            #[cfg(feature = "s3")]
            Backend::S3 { .. } => "s3",
        }
    }

    pub fn temporary_path(&self) -> PathBuf {
        self.temporary_root.join(format!("{}.part", Uuid::new_v4()))
    }

    /// Torna um arquivo temporario visivel de forma atomica no disco local. No
    /// backend S3, o servidor faz o PUT e so entao remove o temporario.
    pub async fn commit_upload(
        &self,
        temporary: &Path,
        key: &str,
        content_type: &str,
        checksum_sha256_hex: &str,
    ) -> Result<()> {
        #[cfg(not(feature = "s3"))]
        let _ = (content_type, checksum_sha256_hex);
        match &self.backend {
            Backend::Local { root } => {
                let destination = root.join("objects").join(key);
                tokio::fs::rename(temporary, &destination)
                    .await
                    .with_context(|| format!("nao consegui finalizar {}", destination.display()))?;
            }
            #[cfg(feature = "s3")]
            Backend::S3 { client, bucket } => {
                let bytes = tokio::fs::read(temporary).await?;
                let body = aws_sdk_s3::primitives::ByteStream::from(bytes);
                let checksum = STANDARD.encode(hex::decode(checksum_sha256_hex)?);
                client
                    .put_object()
                    .bucket(bucket)
                    .key(key)
                    .content_type(content_type)
                    .checksum_sha256(checksum)
                    .body(body)
                    .send()
                    .await
                    .context("erro enviando objeto ao S3")?;
                let _ = tokio::fs::remove_file(temporary).await;
            }
        }
        Ok(())
    }

    pub async fn delete_object(&self, key: &str) -> Result<()> {
        match &self.backend {
            Backend::Local { root } => {
                let path = root.join("objects").join(key);
                match tokio::fs::remove_file(path).await {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error.into()),
                }
            }
            #[cfg(feature = "s3")]
            Backend::S3 { client, bucket } => {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(key)
                    .send()
                    .await?;
                Ok(())
            }
        }
    }

    pub async fn open_object_file(&self, key: &str) -> Result<tokio::fs::File> {
        match &self.backend {
            Backend::Local { root } => {
                let path = root.join("objects").join(key);
                Ok(tokio::fs::File::open(path).await?)
            }
            #[cfg(feature = "s3")]
            Backend::S3 { .. } => {
                bail!("streaming direto por arquivo local indisponivel para backend S3")
            }
        }
    }

    pub async fn get_object_bytes(&self, key: &str) -> Result<Vec<u8>> {
        match &self.backend {
            Backend::Local { root } => Ok(tokio::fs::read(root.join("objects").join(key)).await?),
            #[cfg(feature = "s3")]
            Backend::S3 { client, bucket } => {
                let response = client.get_object().bucket(bucket).key(key).send().await?;
                Ok(response.body.collect().await?.to_vec())
            }
        }
    }

    pub async fn object_exists(&self, key: &str) -> bool {
        match &self.backend {
            Backend::Local { root } => tokio::fs::metadata(root.join("objects").join(key))
                .await
                .is_ok(),
            #[cfg(feature = "s3")]
            Backend::S3 { client, bucket } => client
                .head_object()
                .bucket(bucket)
                .key(key)
                .send()
                .await
                .is_ok(),
        }
    }

    /// Adaptador temporario para clientes antigos. Upload presigned so existe
    /// quando o servidor foi compilado e configurado com S3.
    pub async fn generate_presigned_upload(
        &self,
        user_id: &str,
        filename: &str,
        content_type: &str,
    ) -> Result<PresignedUpload> {
        #[cfg(feature = "s3")]
        if let Backend::S3 { client, bucket } = &self.backend {
            let attachment_id = Uuid::new_v4().to_string();
            let safe_filename: String = filename
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_'))
                .collect();
            let s3_key = format!("legacy/{user_id}/{attachment_id}-{safe_filename}");
            let config = PresigningConfig::expires_in(Duration::from_secs(900))?;
            let request = client
                .put_object()
                .bucket(bucket)
                .key(&s3_key)
                .content_type(content_type)
                .presigned(config)
                .await?;
            return Ok(PresignedUpload {
                attachment_id,
                upload_url: request.uri().to_string(),
                s3_key,
            });
        }

        let _ = (user_id, filename, content_type);
        bail!("upload legado presigned exige o backend S3")
    }
}
