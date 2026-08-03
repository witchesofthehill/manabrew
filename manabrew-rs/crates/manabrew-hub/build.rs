use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=migrations");

    let mut migrations: Vec<(u32, String)> = fs::read_dir("migrations")
        .expect("read migrations/")
        .map(|entry| {
            entry
                .expect("migrations/ entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .filter(|name| name.ends_with(".sql"))
        .map(|name| {
            let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
            let version = digits
                .parse()
                .unwrap_or_else(|_| panic!("migration {name} must start with a version number"));
            (version, name)
        })
        .collect();
    migrations.sort();

    if let Some(pair) = migrations.windows(2).find(|pair| pair[0].0 == pair[1].0) {
        panic!("migrations {} and {} share a version", pair[0].1, pair[1].1);
    }

    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let mut generated = String::from("const MIGRATIONS: &[(u32, &str, &str)] = &[\n");
    for (version, name) in &migrations {
        println!("cargo:rerun-if-changed=migrations/{name}");
        let path = format!("{manifest}/migrations/{name}");
        generated.push_str(&format!(
            "    ({version}, {name:?}, include_str!({path:?})),\n"
        ));
    }
    generated.push_str("];\n");

    let out = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("migrations.rs");
    fs::write(&out, generated).expect("write migrations.rs");
}
