fn main() {
    println!("cargo::rustc-check-cfg=cfg(forge_backend)");
    if std::env::var_os("CARGO_FEATURE_JAVA_FORGE").is_some()
        || std::env::var_os("CARGO_FEATURE_GRAAL_FORGE").is_some()
    {
        println!("cargo::rustc-cfg=forge_backend");
    }

    #[cfg(feature = "graal-forge")]
    {
        use std::path::PathBuf;

        let lib_dir = std::env::var("FORGE_NATIVE_LIB_DIR").unwrap_or_else(|_| {
            let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(3)
                .expect("repo root above self-hosted-node crate")
                .to_path_buf();
            repo_root
                .join("forge-harness/native/build")
                .display()
                .to_string()
        });

        println!("cargo:rustc-link-search=native={lib_dir}");
        println!("cargo:rustc-link-lib=dylib=forgeharness");
        println!("cargo:rustc-link-arg=-Wl,-rpath,{lib_dir}");
        println!("cargo:rerun-if-env-changed=FORGE_NATIVE_LIB_DIR");
        println!("cargo:rerun-if-changed={lib_dir}/libforgeharness.dylib");
    }
}
