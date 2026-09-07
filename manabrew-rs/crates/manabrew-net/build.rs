fn main() {
    println!("cargo::rustc-check-cfg=cfg(wasm_browser)");
    if std::env::var("CARGO_CFG_TARGET_FAMILY").as_deref() == Ok("wasm")
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("unknown")
    {
        println!("cargo::rustc-cfg=wasm_browser");
    }
}
