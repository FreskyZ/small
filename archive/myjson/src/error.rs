
#[derive(Debug, Eq, PartialEq)]
pub enum Error {
    InvalidNumber, // Not true, false, null but not quoted
    InvalidString, // quoted not correctly escaped, may not be here
    UnexpectedEOF, 
    NotUnicode,    // I guess reader will throw this
}