
use config::MergedResult;
use error::Error;

pub fn apply(actions: MergedResult) -> Result<(), Error> {

    println!("applying: {:?}", actions);
    Ok(())
}

// fn apply_actions(actions: Vec<TargetAction>) {
//     use std::process::Command;
//     use std::env::var as env_var;

//     let mut cmd = Command::new("cmd");
//     let _ = cmd.arg("/K");

//     let mut scripts = Vec::new();
//     let mut new_path = env_var("PATH").unwrap_or("".to_owned());

//     for action in actions {
//         match action {
//             TargetAction::PathAdd(value) => {
//                 new_path = value + ";" + &*new_path;
//             }
//             TargetAction::VariableAdd(var, value) => {
//                 match env_var(var.clone()) {
//                     Ok(origin_path) => {
//                         cmd.env(var, value + ";" + &*origin_path);
//                     }
//                     Err(_) => {
//                         cmd.env(var, value);
//                     } 
//                 }
//             }
//             TargetAction::ScriptExecute(path) => {
//                 scripts.push(path);
//             }
//         }
//     }

//     cmd.env("PATH", new_path);

//     match cmd.spawn() {
//         Ok(mut child) => match child.wait() {
//             Ok(_) => (), // println!("Child exit with status: {:?}", result),
//             Err(e) => println!("Child wait error: {:?}", e),
//         },
//         Err(e) => perrorln!("Process spawn error: {:?}", e),
//     }
// }