//! metro-sim-wasm — wasm-bindgen bindings over sim-core (contract §4).
//!
//! Regenerate the committed pkg with:
//!   wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg

use sim_core::{SimWorld, MAX_VEHICLES, VEHICLE_STRIDE};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    world: SimWorld,
    buf: Vec<f32>, // MAX_VEHICLES * VEHICLE_STRIDE
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(cache_bytes: &[u8]) -> Result<Engine, JsError> {
        let world = SimWorld::from_bytes(cache_bytes).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Engine { world, buf: vec![0.0; MAX_VEHICLES * VEHICLE_STRIDE] })
    }

    /// ValidationSummary as JSON (stations/patterns/runs/services/feed_version).
    pub fn validation_json(&self) -> String {
        serde_json::to_string(&self.world.validation()).unwrap_or_else(|_| "{}".into())
    }

    /// Evaluates into the internal buffer and copies into `out` (a JS-owned
    /// Float32Array view of length >= MAX_VEHICLES*8). Returns vehicle count.
    pub fn evaluate(&mut self, date_yyyymmdd: u32, sec_of_day: f64, out: &mut [f32]) -> usize {
        let count = self.world.evaluate(date_yyyymmdd, sec_of_day, &mut self.buf);
        let n = count * VEHICLE_STRIDE;
        out[..n].copy_from_slice(&self.buf[..n]);
        count
    }
}

/// Layout constants mirrored in src/sim/protocol.ts.
#[wasm_bindgen]
pub fn vehicle_stride() -> usize {
    VEHICLE_STRIDE
}

#[wasm_bindgen]
pub fn max_vehicles() -> usize {
    MAX_VEHICLES
}
