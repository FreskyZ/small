
extern crate xml;

#[macro_use]
mod macros;

mod config;
mod applier;
mod input;
mod error;


// Constant
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

// Dirty things, do not open it
fn current_executable_dir() -> String {
    const MAX_PATH: u32 = 260_u32;

    #[link(name = "kernel32")]
    extern "stdcall" {
        fn GetModuleFileNameW(hModule: *const u8, lpFileNmae: *mut u16, nSize: u32) -> u32;
    }

    let mut file_name: [u16; MAX_PATH as usize] = [0; MAX_PATH as usize];
    unsafe {
        let ret_val = GetModuleFileNameW(0 as *const u8, file_name.get_unchecked_mut(0) as *mut u16, MAX_PATH);
        if ret_val == 0 {
            return String::new();  // Not decided to handle error
        }
    }

    let mut file_name = String::from_utf16_lossy(&file_name);
    loop {
        match file_name.pop() {
            Some(ch) => {
                if ch == '\\' {
                    break; // Pop to path seperater, break loop and return
                } 
            }
            None => { return String::new(); /* Pop to nothing, return */ }
        }
    }
    file_name.push('\\');
    file_name
}

fn config_file_name() -> String {
    current_executable_dir() + CONFIG_FILE_NAME 
}

// InputType distributer
use error::Error;
fn print_usage() {
   println!("{}", USAGE_STRING);
}
fn print_version() {
    println!("{}", VERSION_STRING);
}
fn open_config() {
    use std::process::Command;

    let _ = Command::new("cmd").arg("/C").arg("start").arg(config_file_name()).spawn();
    // let _ = Command::new("vim").arg(".env").spawn();
}

// Retrieve and display info
fn get_info(path: &str, require_list: bool) -> Result<(), Error> {
    use config::Config;
    use config::ConfigResult;

    let config = Config::new(config_file_name());
    match try!(config.input(path, require_list)) {
        result @ ConfigResult::Actions(_) => print!("Target actions for {}: {}", path, result),
        result @ ConfigResult::AvailablePathNodes(_) => print!("Available next nodes for {} are: {}", path, result),
    }

    Ok(())
}

fn batch_apply_actions(paths: Vec<String>) -> Result<(), Error> {
    use config::Config;
    use applier::apply;

    let config = Config::new(config_file_name());
    let (result, errors) = config.batch(paths);

    for error in errors {
        perrorln!("Error: {:?}", error);
    }

    apply(result)
}

// Use this function to more pretty error handle
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

// Change something at branch
fn main() {
    
    match main_with_error() {
        Ok(_) => (),
        Err(e) => println!("Error: {}", e),
    }
}
