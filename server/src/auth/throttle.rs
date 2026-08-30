//! Freio contra forca bruta.
//!
//! Duas contagens independentes: tentativas de login erradas por conta, e
//! criacoes de conta por origem. Ficam separadas do [`super::AuthService`]
//! porque sao a mesma ideia aplicada a dois recursos — e porque assim da para
//! testar o freio sem tocar em banco.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Depois disso o registro de falhas de uma conta e esquecido.
const LOGIN_STATE_TTL: Duration = Duration::from_secs(15 * 60);
/// Espera maxima entre tentativas de login.
const LOGIN_MAX_BACKOFF_SECS: u64 = 30;
const REGISTRATION_WINDOW: Duration = Duration::from_secs(60);
pub(super) const REGISTRATION_ATTEMPTS: usize = 5;

struct LoginFailure {
    failures: u32,
    next_allowed: Instant,
    last_seen: Instant,
}

#[derive(Default)]
pub struct Throttle {
    login_failures: Mutex<HashMap<String, LoginFailure>>,
    registration_attempts: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl Throttle {
    /// Quanto falta esperar antes de aceitar outra tentativa desta conta.
    pub fn login_wait(&self, key: &str) -> Option<Duration> {
        let now = Instant::now();
        let mut failures = self.login_failures.lock().unwrap();
        failures.retain(|_, entry| now.duration_since(entry.last_seen) < LOGIN_STATE_TTL);
        failures
            .get(key)
            .and_then(|entry| entry.next_allowed.checked_duration_since(now))
    }

    /// Backoff exponencial: 1s, 2s, 4s... ate o teto.
    pub fn record_login_failure(&self, key: String) {
        let now = Instant::now();
        let mut failures = self.login_failures.lock().unwrap();
        let entry = failures.entry(key).or_insert(LoginFailure {
            failures: 0,
            next_allowed: now,
            last_seen: now,
        });
        entry.failures = entry.failures.saturating_add(1);
        let seconds = 1u64
            .checked_shl(entry.failures.saturating_sub(1))
            .unwrap_or(LOGIN_MAX_BACKOFF_SECS)
            .min(LOGIN_MAX_BACKOFF_SECS);
        entry.next_allowed = now + Duration::from_secs(seconds);
        entry.last_seen = now;
    }

    pub fn clear_login_failure(&self, key: &str) {
        self.login_failures.lock().unwrap().remove(key);
    }

    /// PROTOTYPE: a origem e o peer TCP. Atras de um proxy local todos compartilham
    /// este limite; uma futura configuracao de proxies confiaveis deve recuperar o IP real.
    pub fn record_registration_attempt(&self, origin: IpAddr) -> Option<Duration> {
        let now = Instant::now();
        let mut attempts = self.registration_attempts.lock().unwrap();
        let entries = attempts.entry(origin).or_default();

        while entries
            .front()
            .is_some_and(|at| now.duration_since(*at) >= REGISTRATION_WINDOW)
        {
            entries.pop_front();
        }
        if entries.len() >= REGISTRATION_ATTEMPTS {
            return entries
                .front()
                .and_then(|at| (*at + REGISTRATION_WINDOW).checked_duration_since(now));
        }

        entries.push_back(now);
        None
    }
}
