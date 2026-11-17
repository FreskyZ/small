use std::fs;
use anyhow::{Result, bail};
use clap::Parser as _;

mod session;
mod text_repr;
mod sse;
mod handler;
mod llm;

#[derive(clap::Parser)]
#[command(name = "huan", about = "huan cli")]
struct Command {
    #[command(subcommand)]
    subcommand: SubCommand,
}

#[derive(clap::Subcommand)]
enum SubCommand {
    #[command(about = "run a session")]
    Run {
        #[arg(long)]
        not_dry: bool,
        filename: String,
    },
    #[command(about = "migrate something")]
    Migrate,
}

fn migrate() -> Result<()> {
    println!("migrate");

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let command = Command::parse();
    let SubCommand::Run{ filename, not_dry } = command.subcommand else {
        return migrate();
    };
    println!("file name {}", filename);

    let session_original_content = fs::read_to_string(&filename)?;
    let (session, request_config) = text_repr::from_str(&filename, &session_original_content)?;
    println!("{}", session);
    let Some(request_config) = request_config else { bail!("missing request config, exit"); };
    println!("{}", request_config);

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };

    let result_message = llm::run(llm::RequestParameters{ dry: !not_dry, api_key, session: &session, config: request_config }).await?;

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", filename);
    fs::write(&filename, output_content)?;

    Ok(())
}
