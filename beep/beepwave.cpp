import std;
// now everything saved by import std is mudada
#include <Windows.h>
// playsound is available in windows.h but you need to explicitly include lib
#pragma comment(lib, "winmm.lib")

constexpr char wave_file_header_template[] =
	// riff chunk header magic
	"RIFF"
	// riff chunk size, to be filled with total size - 8
	// which is sample count * 2 (bytes per sample) * 2 (channels)
	//   + 8 (data chunk header + chunk size) + 24 (fmt chunk) + 8 (the "WAVE" + the "fmt ")
	"\x00\x00\x00\x00"
	// wave chunk header mangic
	"WAVE"
	// fmt chunk header magic
	"fmt "
	// fmt chunk size: 16, exclude the magic and this size
	"\x10\x00\x00\x00"
	// start from this part is a WAVEFORMAT
	// https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex
	// format tag: WAVE_FORMAT_PCM
	"\x01\x00"
	// channel count
	"\x02\x00"
	// sample rate: 44.1khz
	"\x44\xAC\x00\x00"
	// average bytes per second
	// which does not need the avg for pcm file
	// sample rate * bytes per sample * channel count = 44100 * 2 * 2
	"\x10\xb1\x02\x00"
	// block align
	// bytes for sample * channel = 4
	"\x04\x00"
	// bits per sample: 16
	"\x10\x00"
	// data chunk header magic
	"data"
	// data chunk size
	// to be filled with sample count * bytes per sample * channels
	"\x00\x00\x00\x00"
;
// the template is not going to be strlen'd, because it naturally contains \0
constexpr size_t wave_file_header_size = 44;
constexpr size_t riff_chunk_size_offset = 4;
constexpr size_t data_chunk_size_offset = 40;

constexpr const double semi_tone_ratio = 1.0594630943592953; // std::pow is not constexpr
constexpr static auto make_sharp(double tone) -> double { return tone * semi_tone_ratio; }
constexpr static auto make_flat(double tone) -> double { return tone / semi_tone_ratio; }

constexpr const double NO = 0.0;
constexpr const double A4 = 440;
constexpr const double A4s = make_sharp(A4);
constexpr const double B4 = make_sharp(A4s);
constexpr const double C4 = make_sharp(B4) / 2;
constexpr const double C4s = make_sharp(C4);
constexpr const double D4 = make_sharp(C4s);
constexpr const double D4s = make_sharp(D4);
constexpr const double E4 = make_sharp(D4s);
constexpr const double F4 = make_sharp(E4);
constexpr const double F4s = make_sharp(F4);
constexpr const double G4 = make_sharp(F4s);
constexpr const double G4s = make_sharp(G4);

constexpr const double C5 = C4 * 2;
constexpr const double D5 = D4 * 2;
constexpr const double E5 = E4 * 2;
constexpr const double F5 = F4 * 2;
constexpr const double G5 = G4 * 2;

/// <param name="freq">in hertz</param>
/// <param name="duration">in second</param>
/// <param name="bytes">should be writable in some kind of range</param>
/// <returns>sample count</returns>
static auto sample(double freq, double duration, char* bytes) -> size_t {
	const auto sample_count = static_cast<size_t>(44100 * duration);
	// pi constant is not available when import std
	constexpr const double pi = 3.14159265358979323846;
	for (size_t i = 0; i < sample_count; ++i) {
		const auto value = static_cast<std::int16_t>(std::sin(2 * pi * freq * (i / 44100.0)) * 32767);
		bytes[4 * i] = value & 0xFF;
		bytes[4 * i + 1] = value >> 8;
		bytes[4 * i + 2] = value & 0xFF;
		bytes[4 * i + 3] = value >> 8;
	}
	return sample_count;
}

struct tone_and_duration { double tone; double duration; };

/// <returns>allocation transfer ownership to caller, drop by delete[]</returns>
static auto make_wave_file(const std::vector<tone_and_duration>& tones) -> const char* {
	const auto total_duration = std::ranges::fold_left(tones.begin(), tones.end(),
		0.0, [](double acc, const tone_and_duration& td) { return acc + td.duration; });
	const auto total_sample_count = static_cast<size_t>(total_duration * 44100);
	const auto byte_size = total_sample_count * 4 + 44 + 1000; // 1000: arbitrary buffer

	const auto all_bytes = new char[byte_size];
	std::memcpy(all_bytes, wave_file_header_template, wave_file_header_size);
	*(int*)&all_bytes[riff_chunk_size_offset] = static_cast<int>(total_sample_count * 4 + 40);
	*(int*)&all_bytes[data_chunk_size_offset] = static_cast<int>(total_sample_count * 4);

	auto bytes = all_bytes + wave_file_header_size;
	for (const auto& tone_and_duration : tones) {
		const auto tone = tone_and_duration.tone;
		const auto duration = tone_and_duration.duration;
		const auto sample_count = sample(tone, duration, bytes);
		bytes += sample_count * 4;
	}
	return all_bytes;
}

int main() {
	//const auto major_scale = make_wave_file({
	//	{ 0, 0.1 },
	//	{ C4, 0.5 }, { 0, 0.1 }, { D4, 0.5 }, { 0, 0.1 },
	//	{ E4, 0.5 }, { 0, 0.1 }, { F4, 0.5 }, { 0, 0.1 },
	//	{ G4, 0.5 }, { 0, 0.1 }, { A4, 0.5 }, { 0, 0.1 },
	//	{ B4, 0.5 }, { 0, 0.1 },
	//});
	//PlaySoundA(major_scale, nullptr, SND_MEMORY);
	//delete[] major_scale

	const auto CEG = make_wave_file({ { C4, 0.5 }, { E4, 0.5 }, { G4, 0.5 } });
	PlaySoundA(CEG, nullptr, SND_MEMORY);
	delete[] CEG;

	const auto C = make_wave_file({ { C4, 0.5 } });
	const auto E = make_wave_file({ { NO, 0.1 }, { E4, 0.5 } });
	const auto G = make_wave_file({ { NO, 0.2 }, { G4, 0.5 } });
	PlaySoundA(C, nullptr, SND_MEMORY | SND_ASYNC);
	PlaySoundA(E, nullptr, SND_MEMORY | SND_ASYNC | SND_NOSTOP);
	PlaySoundA(G, nullptr, SND_MEMORY | SND_NOSTOP);
	delete[] C;
	delete[] E;
	delete[] G;

	//const auto birthday = make_wave_file({
	//	{G4, 0.375}, {G4, 0.125}, {A4, 0.5}, {G4, 0.5}, {C5, 0.5}, {B4, 1},
	//	{G4, 0.375}, {G4, 0.125}, {A4, 0.5}, {G4, 0.5}, {D5, 0.5}, {C5, 1},
	//	{G4, 0.375}, {G4, 0.125}, {G5, 0.5}, {E5, 0.5}, {C5, 0.5}, {B4, 0.5}, {A4, 0.5},
	//	{F5, 0.375}, {F5, 0.125}, {E5, 0.5}, {C5, 0.5}, {D5, 0.5}, {C5, 1},
	//});
	//PlaySoundA(birthday, nullptr, SND_MEMORY);
	//delete[] birthday;
}
