#[tokio::main]
async fn main() {
    if self_hosted_node::engine_backend::java_backend::run_engine_worker() {
        return;
    }
    self_hosted_node::cli_entry().await;
}
