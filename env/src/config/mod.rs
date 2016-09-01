extern crate xml;

use std::fs::File;

// https://github.com/netvl/xml-rs
use self::xml::reader::{ EventReader as XmlReader, XmlEvent };

mod target;
mod path_node;
mod config_error;

pub use self::path_node::PathNode;
pub use self::config_error::ConfigError;

pub struct Config {
    roots: Vec<PathNode>,
}

impl Config {
    pub fn parse<'a>() ->  Result<Config, ConfigError<'a>> {
        Config::parse_file(".env")
    }

    pub fn parse_file<'a>(file_path: &'a str) -> Result<Config, ConfigError<'a>> {
        
        // let file = File::open(file_path);
        // let file = if file.is_err() {
        //     return Err(ConfigError::FailOpenFile { file_name: file_path, inner_exception: file.unwrap_err() });
        // } else {
        //     file.unwrap()
        // };

        let document = XMLDocument::load(file_path) /* XMLDocument */;
        let xroot = document.get_root_element() /* XMLElement */;
        let xtargets = xroot.get_elements("env/targets").nth(0).unwrap().as_element();
        let xpaths = xroot.get_elements("env/paths") /* XMLNodeList */ .nth(0).unwrap().as_element() /* XMLElement */;

        Ok(Config { roots: Vec::new() })
    }
}

#[cfg(test)]
mod tests {
    use super::Config;
    use super::config_error::ConfigError;
    use std::fs::File;

    #[test]
    #[should_panic]
    fn load_xml_file_fail() {
        match Config::parse_file(r"test\file_cannot_open.env") {
            Ok(_) => { },
            Err(e) => match e {
                ConfigError::FailOpenFile{ .. } => panic!("load config file failed, {}", e),
                // _ => { /* not panic to make test fail */ }
            }
        }
    }

    #[test]
    #[ignore]
    fn feasibility_io_error() {
        match File::open(".env") {
            Ok(_) => (),
            Err(e) => perrorln!("Error display is {}", e),
        }
    }

    #[test]
    fn load_xml_file() {
        let _config = Config::parse_file(r"C:\Users\Fresk\OneDrive\Binary\Path\.env");
    }
}