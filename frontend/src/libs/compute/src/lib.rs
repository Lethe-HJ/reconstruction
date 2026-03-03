#[cfg(feature = "interpolation")]
mod interpolation;
#[cfg(feature = "interpolation")]
pub use interpolation::{get_interpolated_shape, linear_interpolate_3d, linear_interpolate_3d_wasm};

#[cfg(feature = "surfacenets")]
mod surfacenets;
#[cfg(feature = "surfacenets")]
pub use surfacenets::{surface_nets, surface_nets_with_potential};
