//! sim-core — cache model + schedule evaluation for Greater Bangkok Metro Mini 3D.
//! Pure Rust; NO wasm / JS dependencies (contract §3).

pub mod calendar;
pub mod geo;
pub mod model;
pub mod world;

pub use model::{
    CacheDoc, PatternDoc, PatternStop, RouteDoc, RunDoc, ServiceDoc, StationDoc, TMB_MAGIC,
    TMB_VERSION,
};
pub use world::{
    CacheError, SimWorld, ValidationSummary, MAX_VEHICLES, VEHICLE_STRIDE,
};
