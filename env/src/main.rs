// use std::env;
// use std::process;

// config.get_target(Vec<&str>) -> Option<Target>
// config.get_next_hint(Vec<&str>) -> Vec<&str>

// env --help | env --list
// Available next token:
//  python | py
//  vcpp | msvc 
//  git
//  rust 
// Available option:
//  --help | --list | <empty> | -h | -l (any case)
//  --version | -v (any case)

#![allow(dead_code)]

#[macro_use]
mod macros;
mod config;

fn main() {
    // let key = match env::args().nth(1) {
    //     None => "PATH".to_owned(),
    //     Some(key) => key
    // };

    // println!("Current dir: {}", env::current_dir().unwrap().as_path().display());
    // let key = key.as_str();
    // match env::var_os(key) {
    //     Some(paths) => {
    //         for path in env::split_paths(&paths) {
    //             match path.to_str() {
    //                 Some(path) => if !path.is_empty() { println!("'{}'", path) },
    //                 _ => (),
    //             };
    //         }
    //     }
    //     None => println!("{} is not defined in the environment.", key)
    // }
    
    // env::set_var("PATH", env::var("PATH").unwrap_or("".to_owned()) + ";" + env::current_dir().unwrap().as_path().to_str().unwrap());
    // let mut child = process::Command::new("cmd").arg("/K").spawn().expect("failed to start cmd");
    // let _ = child.wait();

    // let _config = Config::parse();

    println!("helloworld");
    perrorln!("HELLOWORLD IN STDERR: {}", 2);
}