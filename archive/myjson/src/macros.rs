
#[macro_export]
macro_rules! null {
    () => (Value::Null)
}

#[macro_export]
macro_rules! array {
    [] => (Value::Array(Vec::new()));
    [$($value: expr, )+] => ({
        let mut temp = Vec::new();
        $(
            temp.push(Value::from($value));
        )+
        Value::Array(temp)
    })
}

#[macro_export]
macro_rules! object {
    [] => (Value::Object(Object::from(Vec::new())));
    [$($name: expr => $value: expr, )+] => ({
        let mut temp = Vec::new();
        $(
            temp.push(($name.to_owned(), Value::from($value)));
        )+
        Value::Object(Object::from(temp))
    })
}

/// Macro for printing to the standard error.
/// 
/// Equivalent to `print!` macro except that print to stderr
///
/// Standard error unsually is not buffered and displayed immediately, and 
/// default rust test configuration shut down stdout and keeps stderror open 
///
/// # Panics
/// 
/// Panics if writing to io::stderr() fails.
///
/// # Examples
/// ```rust
/// perror!("Hello ");
/// perror!("{}", "World");
/// perror!("!");      // Get `Hello World!` at stderr immediately
/// ```
#[macro_export]
macro_rules! perror {
    ($($arg:tt)*) => ({
        use std::io::Write;
        let _ = write!(&mut ::std::io::stderr(), $($arg)* );
    })
}

/// Macros for printing to the standard output, with a newline
///
/// Use the `format!` syntax to write data to the standard error, see 
/// `std::fmt` for more information
///
/// # Panics
/// 
/// Panics if writing to `io::stderr()` fails
///
/// # Examples
/// ```rust
/// perrorln!("Hello world!");
/// perrorln!("format {} arguments", "some");
/// ```
#[macro_export]
macro_rules! perrorln {
    ($($arg:tt)*) => ({
        use std::io::Write;
        let _ = writeln!(&mut ::std::io::stderr(), $($arg)* );
    })
}
