
#![allow(dead_code)]
#![allow(unused_imports)]

extern crate xml;

#[macro_use]
mod macros;

mod config;
mod applier;
mod input;
mod error;

use config::TargetAction;
use error::Error;

const USAGE_STRING : &'static str = 
"Usage: 

    env path/to/target [path/to/another/target]
    env Options

    Open new command prompt and add path or other environment variables or
    execute a certain script. Paths and Targets are pre configured in same
    directory file `.env`

Options:

    --list:<path>, -l<path>     List available next path nodes for these 
                                    paths, empty means root
    --target:<path>, -t<path>   List target actions for the paths
    --version, -v               Print version and quit
    --help, -h                  Print this help string
    --config, -c                Open config file with default text editor
";
const VERSION_STRING : &'static str = "FreskyZ's Environment Setter 0.1.0";
const CONFIG_FILE_NAME: &'static str = ".env";

fn print_usage() {
   println!("{}", USAGE_STRING);
}
fn print_version() {
    println!("{}", VERSION_STRING);
}
fn open_config() {
    use std::process::Command;

    let _ = Command::new("cmd").arg("/C").arg("start").arg(CONFIG_FILE_NAME).spawn();
    // let _ = Command::new("vim").arg(".env").spawn();
}

// Retrieve and display info
fn get_info(path: &str, require_list: bool) -> Result<(), Error> {
    use config::Config;
    use config::ConfigResult;

    let config = Config::new(CONFIG_FILE_NAME);
    match try!(config.input(path, require_list)) {
        result @ ConfigResult::Actions(_) => print!("Target actions for {}: {}", path, result),
        result @ ConfigResult::AvailablePathNodes(_) => print!("Available next nodes for {} are: {}", path, result),
    }

    Ok(())
}

fn batch_apply_actions(paths: Vec<String>) -> Result<(), Error> {
    use config::Config;
    use applier::apply;

    let config = Config::new(CONFIG_FILE_NAME);
    let (result, errors) = config.batch(paths);

    for error in errors {
        perrorln!("Error: {:?}", error);
    }

    apply(result)
}

// Use this function to better error handle
fn main_with_error() -> Result<(), Error> {
    use std::env;
    use input::InputType;

    match try!(InputType::get(env::args())) {
        InputType::Help => Ok(print_usage()),
        InputType::Version => Ok(print_version()),
        InputType::OpenConfig => Ok(open_config()),
        InputType::GetInfo { path, require_list } => get_info(&*path, require_list),
        InputType::Paths { paths } => batch_apply_actions(paths),
    }
}

fn main() {

    match main_with_error() {
        Ok(_) => (),
        Err(e) => println!("Error: {}", e),
    }
}
