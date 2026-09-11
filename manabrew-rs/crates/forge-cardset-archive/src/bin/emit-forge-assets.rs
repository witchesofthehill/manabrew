use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(archive_path), Some(out_path)) = (args.next(), args.next()) else {
        eprintln!("usage: emit-forge-assets <cardset.rkyv> <out.txt>");
        std::process::exit(1);
    };
    let archive_path = PathBuf::from(archive_path);
    let out_path = PathBuf::from(out_path);

    let bytes = std::fs::read(&archive_path).unwrap_or_else(|error| {
        eprintln!("cannot read {}: {error}", archive_path.display());
        std::process::exit(1);
    });
    let bundle = forge_cardset_archive::forge_asset_bundle(&bytes).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
    let kib = bundle.len() / 1024;
    std::fs::write(&out_path, bundle.as_bytes()).unwrap_or_else(|error| {
        eprintln!("cannot write {}: {error}", out_path.display());
        std::process::exit(1);
    });
    println!("wrote {} ({} KiB)", out_path.display(), kib);
}
