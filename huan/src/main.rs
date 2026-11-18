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
    #[command(about = "run one step: one chat completion or request response roundtrip, or run tools in one message")]
    Step {
        #[arg(long, help = "workspace directory for fs tools")]
        workspace: Option<String>,
        file_name: String,
        #[arg(long)]
        not_dry: bool,
    },
    #[command(about = "migrate something")]
    Migrate,
}

async fn step(workspace: Option<&str>, file_name: &str, dry: bool) -> Result<()> {
    println!("step {}", file_name);

    let session_original_content = fs::read_to_string(file_name)?;
    let (session, request_config) = text_repr::from_str(file_name, &session_original_content)?;
    println!("{}", session);
    let Some(request_config) = request_config else { bail!("missing request config, exit"); };
    println!("{}", request_config);

    // unwrap: validated request config message id exist
    let request_message = session.messages.iter().find(|m| m.id == request_config.message_id).unwrap();

    let result_message = if request_message.role.is_user() {
        let Ok(api_key) = std::env::var("HUAN_API_KEY") else {
            bail!("env var HUAN_API_KEY missing");
        };
        llm::run(llm::RequestParameters{ dry, api_key, session: &session, config: request_config }).await?
    } else if request_message.role.is_user() && request_message.content.iter().any(|b| b.is_tool_use()) {
        handler::run(workspace, &session, request_config)?
    } else {
        bail!("request config message id is an assistant message but don't have tool use blocks?")
    };

    let result_message = text_repr::to_string(&result_message)?;
    let output_content = format!("{}\n{}", session_original_content, result_message);
    println!("write {}", file_name);
    fs::write(file_name, output_content)?;
    Ok(())
}

fn migrate() -> Result<()> {
    println!("migrate");

    let mut session_count = 0;
    let mut message_count = 0;
    let mut character_count = 0;
    for entry in fs::read_dir("/workspaces/huan-data-stage")? {
        let entry = entry?;
        let entry_path = entry.path();
        let file_name = entry_path.file_stem().unwrap().to_str().unwrap();
        // this is enough for directory content currently
        if file_name.len() == 15 && file_name.as_bytes()[8] == b'-' {
            let original_content = fs::read_to_string(&entry_path)?;
            println!("{}", file_name);
            let (session, _request_config) = text_repr::from_str(file_name, &original_content)?;
            // println!("{}", session);
            // if let Some(request_config) = request_config {
            //     println!("{}", request_config);
            // }
            session_count += 1;
            message_count += session.messages.len();
            for message in &session.messages {
                for block in &message.content {
                    if let crate::session::ContentBlock::Text{ value, .. } = block {
                        character_count += value.chars().count();
                    }
                }
            }
        }
    }
    println!("{} {} {}", session_count, message_count, character_count);

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let command = Command::parse();
    match command.subcommand {
        SubCommand::Step{ workspace, file_name, not_dry } => step(workspace.as_deref(), &file_name, !not_dry).await?,
        SubCommand::Migrate => migrate()?,
    }
    Ok(())
}
