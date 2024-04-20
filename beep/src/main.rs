mod wave;
mod midi;

fn main() -> Result<(), std::io::Error> {
    midi::test()
}
