use winit::window::Icon;

pub fn get_app_icon() -> Option<Icon> {
    let icon_bytes = include_bytes!("../../resources/icon-dark.png");
    if let Ok(image) = image::load_from_memory(icon_bytes) {
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let rgba_vec = rgba.into_raw();
        Icon::from_rgba(rgba_vec, width, height).ok()
    } else {
        None
    }
}
