use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(archive_path), Some(out_path)) = (args.next(), args.next()) else {
        eprintln!("usage: emit-forge-assets <cardset.rkyv> <out.txt> [<out.index>]");
        std::process::exit(1);
    };
    let index_path = args.next();
    let archive_path = PathBuf::from(archive_path);
    let out_path = PathBuf::from(out_path);

    let bytes = std::fs::read(&archive_path).unwrap_or_else(|error| {
        eprintln!("cannot read {}: {error}", archive_path.display());
        std::process::exit(1);
    });

    let write = |path: &PathBuf, body: &[u8]| {
        std::fs::write(path, body).unwrap_or_else(|error| {
            eprintln!("cannot write {}: {error}", path.display());
            std::process::exit(1);
        });
    };

    match index_path {
        Some(index_path) => {
            let (blob, index) = forge_cardset_archive::forge_asset_bundle_indexed(&bytes)
                .unwrap_or_else(|error| {
                    eprintln!("{error}");
                    std::process::exit(1);
                });
            let index_path = PathBuf::from(index_path);
            write(&out_path, blob.as_bytes());
            write(&index_path, index.as_bytes());
            println!(
                "wrote {} ({} KiB) + {} ({} lines)",
                out_path.display(),
                blob.len() / 1024,
                index_path.display(),
                index.lines().count()
            );
        }
        None => {
            let bundle =
                forge_cardset_archive::forge_asset_bundle(&bytes).unwrap_or_else(|error| {
                    eprintln!("{error}");
                    std::process::exit(1);
                });
            write(&out_path, bundle.as_bytes());
            println!("wrote {} ({} KiB)", out_path.display(), bundle.len() / 1024);
        }
    }
}
