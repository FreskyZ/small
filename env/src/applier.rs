
use config::MergedResult;
use config::MergedVarAdd;
use error::Error;

fn apply_var_add(varadd: MergedVarAdd) -> Result<(), Error> {
    use std::env::var;
    use std::env::split_paths;
    use std::env::join_paths;
    use std::env::set_var;
    use std::env::VarError;
    use std::path::PathBuf;

    let origin = match var(varadd.var.clone()) {
        Ok(origin) => origin,
        Err(VarError::NotPresent) => "".to_owned(),
        Err(e @ VarError::NotUnicode(_)) => return Err(Error::EnvironmentVariableSystemCallError { e: e }),
    };
    let mut origin_splited = split_paths(&origin).collect::<Vec<PathBuf>>();
    for value in varadd.values {
        origin_splited.insert(0, PathBuf::from(value));
    }
    let joint_new = try!(join_paths(origin_splited).map_err(|e| Error::EnvironmentVariableOperationError { e: e }));
    set_var(varadd.var, joint_new);

    Ok(())
}

struct TempFile {
    file_name: String,
}
impl TempFile {
    fn process_unique_temp_name() -> String {

        #[link(name = "kernel32")]
        extern "stdcall" {
            #[allow(non_camel_case_types)]
            fn GetCurrentProcessId() -> u32;
        }
        const TEMP_FILE_NAME_HEAD: &'static str = ".env_temp_";
        const TEMP_FILE_NAME_EXTENSION : &'static str = ".bat";
        use current_executable_dir;

        unsafe {
            current_executable_dir() + &TEMP_FILE_NAME_HEAD.to_owned() + &format!("{}", GetCurrentProcessId()) + TEMP_FILE_NAME_EXTENSION
        }
    }
}
impl Drop for TempFile {
    fn drop(&mut self) {
        use std::fs::remove_file;
        let _ = remove_file(&self.file_name); // Ignore error
    }
}

fn scripts_to_temp_file(scripts: Vec<String>) -> Result<TempFile, Error> {
    use std::fs::File;
    use std::io::Write;

    let file_name = TempFile::process_unique_temp_name();
    let mut file = try!(File::create(&file_name)
                        .map_err(|e| Error::TemporaryFileOperationError { e: e }));

    if scripts.len() == 0 {
        return Ok(TempFile { file_name: file_name });
    }

    let content = scripts.into_iter()
           .fold("@echo off\n".to_owned(), |arg, script| format!("{}CALL \"{}\"\n", arg, script));

    file.write(content.as_bytes())
        .map(|_| TempFile { file_name: file_name })
        .map_err(|e| Error::TemporaryFileOperationError { e: e })
}

pub fn apply(action: MergedResult) -> Result<(), Error> {
    use std::process::Command;

    // Add var
    for varadd in action.vars {
        try!(apply_var_add(varadd));
    }
    try!(apply_var_add(action.paths));
    
    // Prepare script
    let need_new_line = !action.scripts.is_empty();
    let temp_file = try!(scripts_to_temp_file(action.scripts));
    
    // Spawn
    if need_new_line { println!(""); } // Println before spawn
    match Command::new("cmd").arg("/K").arg(&temp_file.file_name).spawn() {
        Ok(mut child) => match child.wait() {
            Ok(_) => Ok(()), 
            Err(e) => Err(Error::ProcessError { e: e }),
        },
        Err(e) => Err(Error::ProcessError { e: e }),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    #[ignore]
    fn apply_script() {
        // use super::scripts_to_arg;
        // assert_eq!("@echo off\nCALL \"123\"\nCALL \"456\"\n", scripts_to_arg(vec!["123".to_owned(), "456".to_owned()]));
    }
}
