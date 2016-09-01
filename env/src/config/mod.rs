extern crate xml;

use std::fs::File;

// https://github.com/netvl/xml-rs
use self::xml::reader::{ EventReader as XmlReader, XmlEvent };

mod target;
mod config_error;

pub use self::target::Target;
pub use self::config_error::ConfigError;

pub fn get_target(path: Vec<&str>) -> Result<Target, ConfigError> {
    
    let file = try!(File::open(".env")
        .map_err(|e| ConfigError::FailOpenFile { inner_exception: e }));

    let parser = XmlReader::new(file);
    let mut depth = 0;
    let indents = ["", "  ", "    ", "      ", "        ", "          ", "            "];
    for e in parser {
        match e {
            Ok(XmlEvent::StartElement { name, attributes, .. }) => {
                perror!("{}<{}", indents[depth], name);
                for attribute in &attributes {
                    perror!(" {}", attribute);
                }
                perrorln!(">");
                depth += 1;
            }
            Ok(XmlEvent::EndElement { name }) => {
                depth -= 1;
                perrorln!("{}</{}>", indents[depth], name);
            }
            Err(e) => {
                perrorln!("Error: {}", e);
            }
            _ => ()
        }
    }

    Ok(Target::new())
}

#[cfg(test)]
mod tests {
    // use super::config_error::ConfigError;
    use super::get_target;

    #[test]
    fn load_xml_file() {
        match get_target(vec!["vcpp", "19", "amd64"]) {
            Ok(_) => (),
            Err(e) => perrorln!("Error: {}", e),
        }
    }
}