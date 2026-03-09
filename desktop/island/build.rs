fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        let icon_path = "resources/icon-dark.ico";
        if std::path::Path::new(icon_path).exists() {
            let mut res = winres::WindowsResource::new();
            res.set_icon(icon_path);
            res.compile().unwrap();
        } else {
            println!(
                "cargo:warning=Icon file not found: {}, executable will use default icon",
                icon_path
            );
        }
    }
}
