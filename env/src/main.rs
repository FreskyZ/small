
#![allow(dead_code)]

use std::env::{ args, Args };
use std::process::{ Command };

// Usage:
//      env /python/msvc16/amd64 /git/27
//      env /python --list  # or `-l` list only available for one path
//          # subpath for `/python`: 2.7(27, 2), msvc16, amd64 
// Option:
//      --version | -v  # any case, quit immediately
//      --setup | -s   # open config file for setup
//      --help | -h | any other, for help string, quit immediately

#[macro_use]
mod macros;
mod config;

use config::{ get_target, ConfigResult };

const USAGE_STRING : &'static str = 
"Usage: 

    env [Option] [path/to/target]* 

Options:

    <path/to/target>    Path to target in the config file
                            multiple paths supported
    --list, -l          List available next path nodes for these paths, 
                            empty means root
    --version, -v       Print version and quit
    --help, -h          Print this help string
    --config, -c        Open config file with default text editor

    Open new command prompt and apply the target actions include add path 
    and other environment variables and execute a certain script

    Paths and Targets are pre configured in same directory file `.env`
";

fn print_usage() {
   println!("{}", USAGE_STRING);
}

#[derive(Debug)]
pub enum SpecialOptions {
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
pub fn process_input(args: Args) -> Option<(Vec<String>, bool)> {

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

fn apply_result(_results: Vec<ConfigResult>) {
    
}

fn main() {

    let args = args();
    // print_usage();

    let (mut paths, has_list) = match process_input(args) {
        Some((paths, has_list)) => (paths, has_list),
        None => return,
    };
    if paths.is_empty() {
        paths.push("".to_owned());
    } 

    println!("paths: {:?}, has_list: {}", paths, has_list);

    let mut configs = Vec::new();
    for path in paths {
        match get_target(".env", &path.split('/').collect::<Vec<&str>>(), has_list) {
            Ok(result) => configs.push(result),
            Err(e) => perror!("Error parsing `{}`: {:?}", path, e),
        }
    }

    println!("Results: {:?}", configs);
    apply_result(configs);
}

#[cfg(test)]
mod tests {
    // use super::process_input;

    #[test]
    #[ignore]
    fn preprocess() {

    }
}