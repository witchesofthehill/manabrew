use std::collections::BTreeMap;
use std::time::Duration;

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;

use manabrew_hub::dto::AssetKind;

use crate::config::AssetConfig;
use crate::rate_limit::RateLimiter;

pub const CONTENT_TYPE: &str = "image/webp";

const PRESIGN_TTL: Duration = Duration::from_secs(15 * 60);

type Error = Box<dyn std::error::Error + Send + Sync>;

pub struct PresignedUpload {
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub public_url: String,
}

pub struct AssetService {
    pub store: ObjectStore,
    pub limiter: RateLimiter,
    pub quota_bytes: u64,
    pub reservation_ttl_seconds: i64,
}

impl AssetService {
    pub fn new(config: &AssetConfig) -> Self {
        AssetService {
            store: ObjectStore::new(config),
            limiter: RateLimiter::new(config.uploads_per_hour),
            quota_bytes: config.quota_bytes,
            reservation_ttl_seconds: config.reservation_ttl_seconds,
        }
    }
}

pub struct ObjectStore {
    client: Client,
    bucket: String,
    public_base_url: String,
}

impl ObjectStore {
    pub fn new(config: &AssetConfig) -> Self {
        let credentials = Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "manabrew-hub",
        );
        let client = Client::from_conf(
            aws_sdk_s3::Config::builder()
                .behavior_version(BehaviorVersion::latest())
                .region(Region::new(config.region.clone()))
                .endpoint_url(&config.endpoint)
                .force_path_style(config.path_style)
                .credentials_provider(credentials)
                .build(),
        );
        ObjectStore {
            client,
            bucket: config.bucket.clone(),
            public_base_url: config.public_base_url.clone(),
        }
    }

    pub fn public_url(&self, object_key: &str) -> String {
        format!("{}/{object_key}", self.public_base_url)
    }

    /// Signs `content-length` so the browser cannot upload more bytes than the
    /// reservation the quota was checked against — a body of any other size
    /// fails the signature at the endpoint instead of landing in the bucket.
    pub async fn presign_put(
        &self,
        object_key: &str,
        byte_size: u64,
    ) -> Result<PresignedUpload, Error> {
        let presigned = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(object_key)
            .content_type(CONTENT_TYPE)
            .content_length(byte_size as i64)
            .presigned(PresigningConfig::expires_in(PRESIGN_TTL)?)
            .await?;
        Ok(PresignedUpload {
            url: presigned.uri().to_string(),
            headers: presigned
                .headers()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            public_url: self.public_url(object_key),
        })
    }

    pub async fn size(&self, object_key: &str) -> Result<Option<u64>, Error> {
        let head = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(object_key)
            .send()
            .await;
        match head {
            Ok(output) => Ok(Some(
                output.content_length().unwrap_or_default().max(0) as u64
            )),
            Err(error) if error.as_service_error().is_some_and(|it| it.is_not_found()) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn delete(&self, object_key: &str) -> Result<(), Error> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(object_key)
            .send()
            .await?;
        Ok(())
    }
}

pub fn object_key(account_id: &str, kind: AssetKind, asset_id: &str) -> String {
    format!("{account_id}/{}/{asset_id}.webp", kind.folder())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> ObjectStore {
        ObjectStore::new(&AssetConfig {
            endpoint: "https://account.r2.cloudflarestorage.com".into(),
            region: "auto".into(),
            bucket: "manabrew-assets".into(),
            access_key_id: "access-key".into(),
            secret_access_key: "secret-key".into(),
            public_base_url: "https://assets.manabrew.app".into(),
            path_style: false,
            quota_bytes: 1024,
            reservation_ttl_seconds: 60,
            uploads_per_hour: 60,
        })
    }

    #[tokio::test]
    async fn presigned_put_pins_the_reserved_length() {
        let presigned = store()
            .presign_put(
                "anacleto/avatar/2a1f7c8e-0000-4000-8000-000000000001.webp",
                4096,
            )
            .await
            .expect("presign");
        let signed_headers = presigned
            .url
            .split('&')
            .find_map(|param| param.strip_prefix("X-Amz-SignedHeaders="))
            .expect("signed headers");
        assert!(
            signed_headers.contains("content-length"),
            "{signed_headers}"
        );
        assert!(signed_headers.contains("content-type"), "{signed_headers}");
        assert_eq!(
            presigned.headers.get("content-length").map(String::as_str),
            Some("4096")
        );
    }

    #[test]
    fn object_keys_are_grouped_by_owner_and_kind() {
        assert_eq!(
            object_key(
                "anacleto",
                AssetKind::Playmat,
                "2a1f7c8e-0000-4000-8000-000000000001"
            ),
            "anacleto/playmats/2a1f7c8e-0000-4000-8000-000000000001.webp"
        );
        assert_eq!(
            store().public_url(&object_key("acct-1", AssetKind::Avatar, "abc")),
            "https://assets.manabrew.app/acct-1/avatar/abc.webp"
        );
    }
}
