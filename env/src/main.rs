
extern crate xml;

use std::env::Args;

#[macro_use]
mod macros;

mod config;
mod applier;
mod input;
mod error;

use config::TargetAction;

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

fn print_usage() {
   println!("{}", USAGE_STRING);
}

#[derive(Debug)]
enum SpecialOptions {
    Version,
    Help,
    List,
    OpenConfig,
}

fn check_special_ops(arg: &str) -> Option<SpecialOptions> {
    let arg = arg.to_lowercase();
    match &*arg {
        "--version" | "-v" => Some(SpecialOptions::Version),
        "--help" | "-h" => Some(SpecialOptions::Help),
        "--list" | "-l" => Some(SpecialOptions::List),
        "--config" | "-c" => Some(SpecialOptions::OpenConfig),
        _ => None, 
    }
}

// process 3 other options and return things to input into config
fn process_input(args: Args) -> Option<(Vec<String>, bool)> {
    use std::process::Command;

    let mut specs = Vec::new();
    let mut configs = Vec::new();

    if args.len() == 1 {
        print_usage();
        return None;
    }

    for arg in args.skip(1) {
        match check_special_ops(&*arg) {
            Some(op) => specs.push(op),
            None => configs.push(arg),
        }
    }

    if specs.len() > 1 {
        perrorln!("Error: Wrong use of options");
        print_usage();
        return None;
    }

    let mut has_list = false;
    if specs.len() == 1 && configs.len() == 0 {
        match specs[0] {
            SpecialOptions::Help => {
                print_usage();
                return None;
            }
            SpecialOptions::OpenConfig => {
                let _ = Command::new("cmd").arg("/C").arg("start").arg(".env").spawn();
                // let _ = Command::new("vim").arg(".env").spawn();
                return None;
            }
            SpecialOptions::Version => {
                println!("fsz-env v0.1.0");
                return None;
            }
            _ => (),
        }
    }
    if specs.len() == 1 {
        has_list = true;
    }

    Some((configs, has_list))
}

fn apply_actions(actions: Vec<TargetAction>) {
    use std::process::Command;
    use std::env::var as env_var;

    let mut cmd = Command::new("cmd");
    let _ = cmd.arg("/K");

    let mut scripts = Vec::new();
    let mut new_path = env_var("PATH").unwrap_or("".to_owned());

    for action in actions {
        match action {
            TargetAction::PathAdd(value) => {
                new_path = value + ";" + &*new_path;
            }
            TargetAction::VariableAdd(var, value) => {
                match env_var(var.clone()) {
                    Ok(origin_path) => {
                        cmd.env(var, value + ";" + &*origin_path);
                    }
                    Err(_) => {
                        cmd.env(var, value);
                    } 
                }
            }
            TargetAction::ScriptExecute(path) => {
                scripts.push(path);
            }
        }
    }

    cmd.env("PATH", new_path);

    match cmd.spawn() {
        Ok(mut child) => match child.wait() {
            Ok(_) => (), // println!("Child exit with status: {:?}", result),
            Err(e) => println!("Child wait error: {:?}", e),
        },
        Err(e) => perrorln!("Process spawn error: {:?}", e),
    }
}

fn main() {
    use std::env::args;
    use config::Config;
    use config::ConfigResult;

    let args = args();
    // print_usage();

    let (mut paths, has_list) = match process_input(args) {
        Some((paths, has_list)) => (paths, has_list),
        None => return,
    };
    if paths.is_empty() {
        paths.push("".to_owned());
    } 

    //println!("paths: {:?}, has_list: {}", paths, has_list);

    let mut config = match Config::new(".env", has_list) {
        Ok(config) => config,
        Err(e) => { println!("Error: {}", e); return; }
    };
    let (result, errors) = config.batch(paths);
    for error in errors {
        perrorln!("Error: {}", error);
    }

    match result {
        nexts @ ConfigResult::AvailablePathNodes(..) => {
            println!("nexts: {:?}", nexts);
        }
        ConfigResult::Actions(actions) => {
            // println!("action: {:?}", actions);
            apply_actions(actions);
        }
    }
}

#[cfg(test)]
mod tests {

    #[test]
    #[ignore]
    fn applying() {
        // use std::env::var as env_var;
        // perrorln!("PATH is {:?}", env_var("PATH").unwrap() + "SOMETHING AT TAILLLLLLLLL");
        // perrorln!("SOMEOTHER is {:?}", env_var("SOMEOTHER"));
    }
}