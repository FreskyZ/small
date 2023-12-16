// make wave file from basic musical tones,
// this is actually the successor of beep.cpp and beepwave.cpp in this folder to learn music theory

// this seems to be a rather complete collection of wave file format
// https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html
// it says additional setup required to use channels more than 2 and bit depth more than 16,
// so this implementation completely always use 2 channels, 16 bit depth and 44.1khz sample rate

use std::fmt;
use std::f32::consts::PI;
use std::io::{Error, Write, Seek, BufWriter, SeekFrom};

pub const SAMPLE_RATE: usize = 44100;

// TODO std::concat_byte! is not stable,
// after switched to that, the sample rate and bitrate can be written directly
const HEADER_TEMPLATE: &str = concat!(
	// riff chunk header magic
	"RIFF",
	// riff chunk size, to be filled with total size - 8
	// = sample count * 2 (bytes per sample) * 2 (channels)
	//   + 8 (data chunk header + chunk size) + 24 (fmt chunk) + 8 (the "WAVE" + the "fmt ")
	"\x00\x00\x00\x00",
	// wave chunk header mangic
	"WAVE",
	// fmt chunk header magic
	"fmt ",
	// fmt chunk size: 16, exclude the magic and this size
	"\x10\x00\x00\x00",
	// format tag: WAVE_FORMAT_PCM = 1
	"\x01\x00",
	// channel count: 2
	"\x02\x00",
	// sample rate: 44.1khz
    // NOTE this should be \x44\xAC\x00\x00, but bare \xAC is invalid utf-8 sequence, so assign later
	"\x00\x00\x00\x00",
	// bitrate as in bytes,
	// = 44100 (sample rate) * 2 (bytes per sample) * 2 (channel count) = 176400
    // NOTE this should be \x10\xB1\x02\x00, but bare \xB1 is invalid utf-8 sequence, so assign later
	"\x00\x00\x00\x00",
	// block align
	// = bytes for sample * channel = 4
	"\x04\x00",
	// bit depth (bytes per sample as bit count): 16
	"\x10\x00",
	// data chunk header magic
	"data",
	// data chunk size
	// to be filled with sample count * bytes per sample * channels
	"\x00\x00\x00\x00",
);

// create audio file from tracks of samples
// - multiple tracks allowed, but they simply merged evenly, result is only 2 identical channels
// - sample value is f32, which is good enough because result sample value is u16,
//   there will be really many fp values and this is exactly
//   the exception case in the recommendation "normally you should always prefer f64"
fn make_audio_file(file_name: &str, tracks: &[Box<[f32]>]) -> Result<(), Error> {
    println!("making {}.mp3", file_name);

    let file = std::fs::File::create(format!("{}.wav", file_name))?;
    let mut writer = BufWriter::new(file);
    writer.write(HEADER_TEMPLATE.as_bytes())?;
    
    let track_count = tracks.len() as f32;
    let sample_count = tracks.iter().map(|track| track.len()).max().unwrap();
    for i in 0..sample_count {
        let sample = tracks.iter().map(|track| *track.get(i).unwrap_or(&0f32)).sum::<f32>() / track_count;
        let sample_data = (sample * 32767f32) as u16;
        writer.write(&sample_data.to_le_bytes())?;
        writer.write(&sample_data.to_le_bytes())?;
    }

    let mut file = writer.into_inner().unwrap();
    // fix for the sample rate and bitrate
    file.seek(SeekFrom::Start(24))?;
    file.write(&(SAMPLE_RATE as u32).to_le_bytes())?;
    file.seek(SeekFrom::Start(28))?;
    file.write(&((SAMPLE_RATE * 4) as u32).to_le_bytes())?;
    // riff chunk size and data chunk size
    file.seek(SeekFrom::Start(4))?;
    file.write(&((sample_count * 4 + 40) as u32).to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write(&((sample_count * 4) as u32).to_le_bytes())?;

    file.flush()?;

    // call ffmpeg to convert that to mp3
    let input_file_name = format!("{}.wav", file_name);
    let output_file_name = format!("{}.mp3", file_name);
    let ffmpeg_output = std::process::Command::new("ffmpeg")
        // -vn: no video
        // -b:a 192k: output bitrate
        // -ar 44100: output sample rate, not need here
        // -ac 2: output channel count, not need here
        // -y: confirm overwrite output file
        .args(["-i", &input_file_name, "-vn", "-b:a", "192k", "-hide_banner", "-y", &output_file_name])
        .output()?;
    if !ffmpeg_output.status.success() {
        let stdout = String::from_utf8_lossy(&ffmpeg_output.stdout);
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        panic!("failed to execute ffmpeg\n{}\n{}\n", stdout, stderr);
    }

    std::fs::remove_file(input_file_name)?;
    Ok(())
}

// floating point arithmetic is currently completely not const eval,
// so you cannot currently constexpr double C4 = some calculation for now, so use these

// https://en.wikipedia.org/wiki/Scientific_pitch_notation
#[derive(Clone, Copy)]
enum PitchName { C, D, E, F, G, A, B }
// https://en.wikipedia.org/wiki/Accidental_(music)
#[derive(Clone, Copy)]
enum Accidental { Sharp, Natural, Flat }

// all members are u8, so can clone and copy
#[derive(Clone, Copy)]
struct Pitch {
    pub name: PitchName,
    // 0 to 8, actually can fit in uint3, 8 is really not "natural" music
    // this don't need private and validation, because the calculate frequency part don't care about this
    // // although some arbitrary does not look large number will result in sound energe to destroy earth
    pub octave: u8,
    pub accidental: Accidental,
}

impl fmt::Display for PitchName {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        use PitchName::*;
        match self {
            C => write!(f, "C"),
            D => write!(f, "D"),
            E => write!(f, "E"),
            F => write!(f, "F"),
            G => write!(f, "G"),
            A => write!(f, "A"),
            B => write!(f, "B"),
        }
    }
}

impl fmt::Display for Accidental {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Sharp => write!(f, "#"),
            Self::Flat => write!(f, "b"),
            Self::Natural => Ok(()),
        }
    }
}
impl fmt::Display for Pitch {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}{}{}", self.accidental, self.name, self.octave)
    }
}

impl Pitch {

    pub fn parse(mut text: &str) -> Option<Self> {
        if text.is_empty() { return None; }
        let accidental = match text.as_bytes()[0] {
            b'#' => { text = &text[1..]; Accidental::Sharp },
            b'b' => { text = &text[1..]; Accidental::Flat },
            _ => Accidental::Natural,
        };

        if text.is_empty() { return None; }
        let name = match text.as_bytes()[0] {
            b'C' => PitchName::C,
            b'D' => PitchName::D,
            b'E' => PitchName::E,
            b'F' => PitchName::F,
            b'G' => PitchName::G,
            b'A' => PitchName::A,
            b'B' => PitchName::B,
            _ => return None,
        };
        text = &text[1..];

        if text.is_empty() { return None; }
        let Ok(octave) = text.parse() else { return None; };
        let result = Self{ name, octave, accidental };
        if result.is_valid() { Some(result) } else { None }
    }

    pub fn is_valid(self) -> bool {
        use PitchName::*;
        use Accidental::*;
        !matches!((self.name, self.accidental), (B, Sharp) | (E, Sharp) | (C, Flat) | (F, Flat))
    }

    // prefer sharp
    #[allow(dead_code)]
    pub fn sharp(self) -> Self {
        use PitchName::*;
        use Accidental::*;
        let new = |name: PitchName, accidental: Accidental| Self{ name, octave: self.octave, accidental };
        let new_1 = |name: PitchName, accidental: Accidental| Self{ name, octave: self.octave + 1, accidental };
        // really cannot think up of a branchless method for this
        match (self.name, self.accidental) {
            (C, Natural) => new(C, Sharp),
            (C, Sharp) | (D, Flat) => /* not F# */ new(D, Natural),
            (D, Natural) => new(D, Sharp),
            (D, Sharp) | (E, Flat) => new(E, Natural),
            (E, Natural) => new(F, Natural),
            (F, Natural) => new(F, Sharp),
            (F, Sharp) | (G, Flat) => new(G, Natural),
            (G, Natural) => new(G, Sharp),
            (G, Sharp) | (A, Flat) => new(A, Natural),
            (A, Natural) => new(A, Sharp),
            (A, Sharp) | (B, Flat) => new(B, Natural),
            (B, Natural) => new_1(C, Natural),
            _ => panic!("invalid pitch {}", self),
        }
    }

    // also prefer sharp
    #[allow(dead_code)]
    pub fn flat(self) -> Self {
        use PitchName::*;
        use Accidental::*;
        let new = |name: PitchName, accidental: Accidental| Self{ name, octave: self.octave, accidental };
        let new_1 = |name: PitchName, accidental: Accidental| Self{ name, octave: self.octave - 1, accidental };
        match (self.name, self.accidental) {
            (C, Natural) => new_1(B, Natural),
            (C, Sharp) | (D, Flat) => new(C, Natural),
            (D, Natural) => new(C, Sharp),
            (D, Sharp) | (E, Flat) => new(D, Natural),
            (E, Natural) => new(D, Sharp),
            (F, Natural) => new(E, Natural),
            (F, Sharp) | (G, Flat) => new(F, Natural),
            (G, Natural) => new(F, Sharp),
            (G, Sharp) | (A, Flat) => new(G, Natural),
            (A, Natural) => new(G, Sharp),
            (A, Sharp) | (B, Flat) => new(A, Natural),
            (B, Natural) => new(A, Sharp),
            _ => panic!("invalid pitch {}", self),
        }
    }
    
    #[allow(dead_code)]
    pub fn prev_octane(self) -> Self {
        Self{ name: self.name, octave: self.octave - 1, accidental: self.accidental }
    }
    #[allow(dead_code)]
    pub fn next_octane(self) -> Self {
        Self{ name: self.name, octave: self.octave + 1, accidental: self.accidental }
    }

    pub fn frequency(self) -> f32 {
        use PitchName::*;
        use Accidental::*;
        let from4 = |base: f32| base * 2.0f32.powi(self.octave as i32 - 4);
        // floating point arithmetic is not const eval
        match (self.name, self.accidental) {
            (C, Natural) => from4(261.6255653005987),
            (C, Sharp) | (D, Flat) => from4(277.18263097687213),
            (D, Natural) => from4(293.66476791740763),
            (D, Sharp) | (E, Flat) => from4(311.126983722081),
            (E, Natural) => from4(329.62755691287003),
            (F, Natural) => from4(349.228231433004),
            (F, Sharp) | (G, Flat) => from4(369.9944227116345),
            (G, Natural) => from4(391.99543598174944),
            (G, Sharp) | (A, Flat) => from4(415.3046975799453),
            (A, Natural) => from4(440.0),
            (A, Sharp) | (B, Flat) => from4(466.1637615180899),
            (B, Natural) => from4(493.8833012561241),
            _ => panic!("invalid pitch {}", self),
        }
    }
}

impl<'a> From<&'a str> for Pitch {
    fn from(text: &'a str) -> Pitch {
        Pitch::parse(text).expect("failed to parse pitch")
    }
}

// https://en.wikipedia.org/wiki/Musical_note
struct Note {
    pub pitch: Pitch,
    pub duration: f64, // duration in second
    pub dynamics: f32, // loadness, should be 0 to 1, use 0 to no sound
}
macro_rules! note {
    (silence, $duration:expr) => {{
        Note{ pitch: "A4".into(), duration: $duration, dynamics: 0.0 }
    }};
    ($pitch:expr, $duration:expr) => {{
        Note{ pitch: $pitch.into(), duration: $duration, dynamics: 0.25 }
    }};
    ($pitch:expr, $duration:expr, $dynamics:expr) => {{
        Note{ pitch: $pitch.into(), duration: $duration, dynamics: $dynamics }
    }};
}

// sampling a track of notes
fn sample(notes: &[Note]) -> Box<[f32]> {
    let total_duration = notes.iter().fold(0f64, |acc, note| acc + note.duration);
    let sample_count = (total_duration * SAMPLE_RATE as f64) as usize;
    let mut result = Vec::with_capacity(sample_count + 100); // add arbitrary length to encounter precision loss
    for note in notes {
        let frequency = note.pitch.frequency();
        let sample_count = (note.duration * SAMPLE_RATE as f64) as usize;
        for i in 0..sample_count {
            result.push(f32::sin(2f32 * PI * frequency * i as f32 / SAMPLE_RATE as f32) * note.dynamics);
        }
    }
    result.into_boxed_slice()
}


fn main() -> Result<(), Error> {

    // make_audio_file("majorscale", &[sample(&[
    //     note!("C4", 0.5),
    //     note!("D4", 0.5),
    //     note!("E4", 0.5),
    //     note!("F4", 0.5),
    //     note!("G4", 0.5),
    //     note!("A4", 0.5),
    //     note!("B4", 0.5),
    // ])])?;

    // make_audio_file("minorscale", &[sample(&[
    //     note!("C4", 0.5),
    //     note!("D4", 0.5),
    //     note!("bE4", 0.5),
    //     note!("F4", 0.5),
    //     note!("G4", 0.5),
    //     note!("bA4", 0.5),
    //     note!("bB4", 0.5),
    // ])])?;

    // make_audio_file("aminorscale", &[sample(&[
    //     note!("A3", 0.5),
    //     note!("B3", 0.5),
    //     note!("C4", 0.5),
    //     note!("D4", 0.5),
    //     note!("E4", 0.5),
    //     note!("F4", 0.5),
    //     note!("G4", 0.5),
    // ])])?;

    // make_audio_file("birthday", &[sample(&[
    //     note!("G4", 0.375), note!("G4", 0.125), note!("A4", 0.5), note!("G4", 0.5), note!("C5", 0.5), note!("B4", 1.0),
    //     note!("G4", 0.375), note!("G4", 0.125), note!("A4", 0.5), note!("G4", 0.5), note!("D5", 0.5), note!("C5", 1.0),
    //     note!("G4", 0.375), note!("G4", 0.125), note!("G5", 0.5), note!("E5", 0.5), note!("C5", 0.5), note!("B4", 0.5), note!("A4", 0.5),
    //     note!("F5", 0.375), note!("F5", 0.125), note!("E5", 0.5), note!("C5", 0.5), note!("D5", 0.5), note!("C5", 1.0),
    // ])])?;

    // make_audio_file("ceg", &[
    //     sample(&[note!("C4", 1.2)]),
    //     sample(&[note!(silence, 0.1), note!("E4", 1.1)]),
    //     sample(&[note!(silence, 0.2), note!("G4", 1.0)]),
    // ])?;

    let mut notes = Vec::new();
    for pitch in ["C4", "D4", "E4", "F4", "G4", "A4", "B4"] {
        for i in 0..100 {
            notes.push(note!(pitch, 0.0001, i as f32 * 0.0025));
        }
        notes.push(note!(pitch, 0.8, 0.25));
        for i in 0..100 {
            notes.push(note!(pitch, 0.0001, 0.2475 - i as f32 * 0.0025));
        }
    }
    make_audio_file("majorscale", &[sample(&notes)])?;

    Ok(())
}
