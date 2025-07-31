// TODO wslpath "$(wslvar USERPROFILE)" to get windows userprofile to get blueprint-storage.dat
// inspired by/learn from https://github.com/asheiduk/factorio-blueprint-decoder/blob/master/decode
// but that's old and not for 2.0 and space age

use anyhow::Context;
use std::fs::File;
use std::io::Read;

mod binary_reader;
mod blueprint_library;
mod name;
mod parser;

fn main() -> anyhow::Result<()> {

    let mut buffer = Vec::new();
    let mut file = File::open("blueprint-storage.dat").with_context(|| "failed to open buluprint-storage.dat")?;
    file.read_to_end(&mut buffer).with_context(|| "failed to read blueprint-storage.dat")?;
    println!("file size {}", buffer.len());

    let mut parser = parser::Parser::new(binary_reader::Reader::new(&buffer));
    let library = parser.parse()?;

    println!("{library:?}");

    Ok(())
}
