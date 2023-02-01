
use object::Object;
use value::Value;
use number::Number;
use error::Error;

// mod v0;

// if not value, is error, so value is not optional
fn expect_value() -> Result<Value, Error> {
    Ok(Value::Null)
}

pub fn from_string(text: String) -> Result<Value, Error> {
    expect_value()
} 
