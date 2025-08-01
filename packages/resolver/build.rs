fn main() {
    // Load .env file
    dotenvy::from_filename(".env.development.local").ok();

    // List the variables you want to pass to your code
    let keys = ["API_KEY", "ALCHEMY_ETH_SEPOLIA_RPC_URL", "NEXT_PUBLIC_contractId", "MOCK_DESTINATION_ADDRESS"];

    for key in keys {
        if let Ok(val) = std::env::var(key) {
            println!("cargo:rustc-env={}={}", key, val);
        }
    }

    // Re-run build.rs if .env changes
    println!("cargo:rerun-if-changed=.env.development.local");
}