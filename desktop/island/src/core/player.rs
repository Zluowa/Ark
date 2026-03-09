// @input: Audio URL (http://127.0.0.1:3010/api/music/url?id=X)
// @output: Playback control (play/stop)
// @position: Core layer — Windows MediaPlayer wrapper for streaming audio

use windows::core::HSTRING;
use windows::Foundation::Uri;
use windows::Media::Core::MediaSource;
use windows::Media::Playback::MediaPlayer;

pub struct MusicPlayer {
    player: MediaPlayer,
}

impl MusicPlayer {
    pub fn new() -> windows::core::Result<Self> {
        Ok(Self {
            player: MediaPlayer::new()?,
        })
    }

    pub fn play_url(&self, url: &str) -> windows::core::Result<()> {
        let uri = Uri::CreateUri(&HSTRING::from(url))?;
        let source = MediaSource::CreateFromUri(&uri)?;
        self.player.SetSource(&source)?;
        self.player.Play()?;
        Ok(())
    }

    pub fn play(&self) {
        let _ = self.player.Play();
    }

    pub fn pause(&self) {
        let _ = self.player.Pause();
    }

    pub fn stop(&self) {
        let _ = self.player.Pause();
    }
}
