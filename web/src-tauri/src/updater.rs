use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub rid: ResourceId,
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_update_with_endpoint<R: Runtime>(
    webview: Webview<R>,
    endpoint: Option<String>,
) -> Result<Option<UpdateMetadata>, String> {
    let mut builder = webview.updater_builder();
    if let Some(endpoint_str) = endpoint {
        let trimmed = endpoint_str.trim();
        if !trimmed.is_empty() {
            let url = url::Url::parse(trimmed).map_err(|e| e.to_string())?;
            builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
        }
    }

    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let formatted_date = update.date.and_then(|date| {
            date.format(&time::format_description::well_known::Rfc3339).ok()
        });
        let metadata = UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: formatted_date,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        };
        Ok(Some(metadata))
    } else {
        Ok(None)
    }
}
