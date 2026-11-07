use crate::cli::args::VariantsArgs;
use crate::cli::{execution_error, output, Failure};

pub fn execute(args: VariantsArgs) -> Result<(), Failure> {
    if args.json {
        return output::write_json(&crate::offered_variants().collect::<Vec<_>>(), false, None).map_err(execution_error);
    }
    println!("Available DDA Variants:\n");
    println!(
        "  {:<8} {:<52} {:<52} {:<16}",
        "Abbrev", "App ID", "Name", "Channels"
    );
    println!("  {}", "-".repeat(128));
    for v in crate::offered_variants() {
        println!(
            "  {:<8} {:<52} {:<52} {:<16}",
            v.abbreviation,
            v.app_id,
            v.name,
            format!("{:?}", v.channel_format)
        );
    }
    Ok(())
}
