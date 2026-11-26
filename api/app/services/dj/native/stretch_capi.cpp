// Minimal C API over Signalsmith Stretch (MIT) used by services/dj/stretch.py.
// The same streaming calls (seek / process / flush with explicit input+output
// lengths per block) are what an Android JNI bridge would use.
#include "signalsmith-stretch/signalsmith-stretch.h"

using Stretch = signalsmith::stretch::SignalsmithStretch<float>;

struct Planar {
    float *base;
    int stride;  // samples per channel in this buffer
    float *operator[](int c) const { return base + (size_t)c * stride; }
};

extern "C" {

void *ss_create(int channels, float sample_rate, int cheaper) {
    auto *s = new Stretch(12345L);  // fixed seed -> deterministic renders
    if (cheaper) s->presetCheaper(channels, sample_rate);
    else s->presetDefault(channels, sample_rate);
    return s;
}

void ss_destroy(void *h) { delete static_cast<Stretch *>(h); }

int ss_input_latency(void *h) { return static_cast<Stretch *>(h)->inputLatency(); }
int ss_output_latency(void *h) { return static_cast<Stretch *>(h)->outputLatency(); }
int ss_seek_length(void *h) { return static_cast<Stretch *>(h)->seekLength(); }

// in: planar [channels][in_stride], uses the first in_n samples of each channel
void ss_seek(void *h, float *in, int in_stride, int in_n, double rate) {
    static_cast<Stretch *>(h)->seek(Planar{in, in_stride}, in_n, rate);
}

void ss_process(void *h, float *in, int in_stride, int in_n, float *out, int out_stride, int out_n) {
    static_cast<Stretch *>(h)->process(Planar{in, in_stride}, in_n, Planar{out, out_stride}, out_n);
}

void ss_flush(void *h, float *out, int out_stride, int out_n, float rate) {
    static_cast<Stretch *>(h)->flush(Planar{out, out_stride}, out_n, rate);
}

}  // extern "C"
