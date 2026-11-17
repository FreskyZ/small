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
    #[command(about = "run one step / one chat completion / one request response round trip")]
    Step {
        #[arg(long)]
        not_dry: bool,
        filename: String,
    },
    #[command(about = "run tool automatically?")]
    Run {
        #[arg(long, help = "workspace directory for fs tools")]
        workspace: String,
        // without attribute making this automatically positional argument 1
        filename: String,
        // and this positional argument 2
        message_id: usize,
    },
    #[command(about = "migrate something")]
    Migrate,
}

async fn step(filename: &str, dry: bool) -> Result<()> {
    println!("step {}", filename);

    let session_original_content = fs::read_to_string(filename)?;
    let (session, request_config) = text_repr::from_str(filename, &session_original_content)?;
    println!("{}", session);
    let Some(request_config) = request_config else { bail!("missing request config, exit"); };
    println!("{}", request_config);

    let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
        bail!("env var HUAN_API_KEY missing");
    };
    let result_message = llm::run(llm::RequestParameters{ dry, api_key, session: &session, config: request_config }).await?;

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", filename);
    fs::write(filename, output_content)?;
    Ok(())
}

// for now fs tools don't use async so this don't need to be async
fn run_tool(filename: &str, message_id: usize, workspace: String) -> Result<()> {
    println!("run {} {}", filename, message_id);

    let session_original_content = fs::read_to_string(filename)?;
    let (session, _) = text_repr::from_str(filename, &session_original_content)?;
    println!("{}", session);
    let Some(message) = session.messages.iter().find(|m| m.id == message_id) else { bail!("invalid message id"); };
    if !message.role.is_assistant() { bail!("message id is not assistant message"); }

    let result_message = handler::run(&session, message, workspace)?;

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", filename);
    fs::write(filename, output_content)?;

    Ok(())
}

fn migrate() -> Result<()> {
    println!("migrate");

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let command = Command::parse();
    match command.subcommand {
        SubCommand::Step{ filename, not_dry } => step(&filename, !not_dry).await?,
        SubCommand::Run{ filename, message_id, workspace } => run_tool(&filename, message_id, workspace)?,
        SubCommand::Migrate => migrate()?,
    }
    Ok(())
}
