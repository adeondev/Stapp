use crate::config::S3Config;
use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::presigning::PresigningConfig;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct MediaStorageService {
    client: S3Client,
    bucket: String,
    public_base: Option<String>,
}

pub struct PresignedUpload {
    pub attachment_id: String,
    pub upload_url: String,
    pub download_url: String,
    pub s3_key: String,
}

impl MediaStorageService {
    pub fn new(cfg: &S3Config) -> Self {
        let creds = Credentials::new(&cfg.access_key, &cfg.secret_key, None, None, "stapp-manual");

        let s3_config = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(cfg.region.clone()))
            .endpoint_url(cfg.endpoint.clone())
            .credentials_provider(creds)
            .force_path_style(true)
            .sleep_impl(aws_smithy_async::rt::sleep::TokioSleep::new())
            .build();

        let client = S3Client::from_conf(s3_config);

        Self {
            client,
            bucket: cfg.bucket.clone(),
            public_base: cfg.public_url.clone(),
        }
    }

    /// Gera uma Presigned PUT URL válida por 15 minutos para upload direto do cliente.
    pub async fn generate_presigned_upload(
        &self,
        user_id: &str,
        filename: &str,
        content_type: &str,
    ) -> Result<PresignedUpload> {
        let attachment_id = Uuid::new_v4().to_string();
        let safe_filename = filename
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
            .collect::<String>();
        let s3_key = format!("uploads/{}/{}-{}", user_id, attachment_id, safe_filename);

        let presign_config = PresigningConfig::expires_in(Duration::from_secs(900))
            .context("erro criando presigning config")?;

        let presigned_req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&s3_key)
            .content_type(content_type)
            .presigned(presign_config)
            .await
            .context("erro gerando presigned put url")?;

        let upload_url = presigned_req.uri().to_string();

        let download_url = if let Some(base) = &self.public_base {
            format!("{}/{}", base.trim_end_matches('/'), s3_key)
        } else {
            format!("/attachments/files/{}", s3_key)
        };

        Ok(PresignedUpload {
            attachment_id,
            upload_url,
            download_url,
            s3_key,
        })
    }

    /// Remove o objeto do bucket.
    ///
    /// Chamada **sempre depois** do commit do banco: a linha em `attachments` e
    /// o unico ponteiro para esta chave, entao sumir com ela primeiro deixaria a
    /// mensagem viva apontando para um arquivo inexistente.
    pub async fn delete_object(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("erro apagando objeto no s3")?;
        Ok(())
    }

    pub async fn get_object_bytes(&self, key: &str) -> Result<(String, Vec<u8>)> {
        let resp = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("erro buscando objeto no s3")?;

        let content_type = resp
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        let bytes = resp.body.collect().await?.to_vec();
        Ok((content_type, bytes))
    }
}
