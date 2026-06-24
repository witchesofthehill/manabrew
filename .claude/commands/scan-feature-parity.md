Check Java-to-Rust porting parity for a module.

Usage: /scan-feature-parity <module_name>
Example: /scan-feature-parity cost

Run the scan structure tool to check file and symbol parity for the given module. If no module is specified, scan all modules.

Steps:

1. Run `yarn scan --module $ARGUMENTS --symbols` to get file and symbol coverage for the target module. If no argument is provided, run `yarn scan` for an overview of all modules.
2. Summarize the results:
   - Which files are ported vs missing
   - Symbol-level coverage for ported files
   - Overall module coverage percentage
3. Highlight the biggest gaps — files or symbols that are missing and would have the most impact if ported next.
