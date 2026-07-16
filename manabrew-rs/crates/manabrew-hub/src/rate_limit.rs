use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

const SECONDS_PER_HOUR: f64 = 3600.0;

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

pub struct RateLimiter {
    per_hour: u32,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    pub fn new(per_hour: u32) -> Self {
        RateLimiter {
            per_hour,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, ip: &str) -> bool {
        let now = Instant::now();
        let capacity = self.per_hour as f64;
        let mut buckets = self.buckets.lock().unwrap();
        buckets.retain(|_, bucket| {
            let refilled = bucket.tokens
                + now.duration_since(bucket.last_refill).as_secs_f64() * capacity
                    / SECONDS_PER_HOUR;
            refilled < capacity
        });
        let bucket = buckets.entry(ip.to_string()).or_insert(Bucket {
            tokens: capacity,
            last_refill: now,
        });
        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * capacity / SECONDS_PER_HOUR).min(capacity);
        bucket.last_refill = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhausts_after_capacity_and_isolates_ips() {
        let limiter = RateLimiter::new(3);
        for _ in 0..3 {
            assert!(limiter.allow("1.1.1.1"));
        }
        assert!(!limiter.allow("1.1.1.1"));
        assert!(limiter.allow("2.2.2.2"));
    }
}
