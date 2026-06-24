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
        println!("cargo:rerun-if-env-changed=FORGE_NATIVE_LIB_DIR");

        match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
            Ok("windows") => {
                println!("cargo:rerun-if-changed={lib_dir}/forgeharness.dll");
                let dll = PathBuf::from(&lib_dir).join("forgeharness.dll");
                if dll.exists() {
                    if let Some(profile_dir) = PathBuf::from(std::env::var("OUT_DIR").unwrap())
                        .ancestors()
                        .nth(3)
                    {
                        let _ = std::fs::copy(&dll, profile_dir.join("forgeharness.dll"));
                    }
                }
            }
            Ok("macos") => {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{lib_dir}");
                println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources");
                println!("cargo:rerun-if-changed={lib_dir}/libforgeharness.dylib");
            }
            _ => {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{lib_dir}");
                println!("cargo:rerun-if-changed={lib_dir}/libforgeharness.so");
            }
        }
    }
}
