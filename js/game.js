(() => {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('找不到游戏画布元素');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('无法获取2D渲染上下文');
    return;
  }
  
  // 确保画布有正确的尺寸
  const W = 960;
  const H = 540;
  const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  
  // 设置画布尺寸
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  
  // 缩放上下文以适应高DPI
  ctx.scale(DPR, DPR);

  // World constants
  const gravity = 1800; // px/s^2
  const moveSpeed = 300; // px/s
  const jumpVelocity = 820; // px/s
  const terminalVy = 1200; // px/s

  // Camera
  let cameraX = 0;

  // Input
  const keys = { left: false, right: false, up: false, jump: false, pause: false };
  const keyMap = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up',
    KeyA: 'left', KeyD: 'right', KeyW: 'up', Space: 'jump',
    KeyP: 'pause', KeyR: 'restart'
  };
  // Track key press events for jump
  let jumpPressed = false;

  // Audio system
  let audioCtx = null;
  let masterGain, musicGain, sfxGain;
  let audioEnabled = true;
  let musicEnabled = true;
  let musicOsc = null, musicInterval = null;
  let bgmBuffer = null, bgmSource = null;
  let bgmLoaded = false, bgmLoading = false;
  
  // 多音乐系统
  const musicTracks = {
    main: 'assets/bgm_main.mp3',
    underground: 'assets/bgm_underground.mp3',
    sky: 'assets/bgm_sky.mp3',
    castle: 'assets/bgm_castle.mp3',
    boss: 'assets/bgm_boss.mp3'
  };
  let loadedTracks = {};
  let currentTrack = 'main';
  let musicVolume = 0.7;
  let sfxVolume = 0.8;
  let audioLoadingProgress = 0;
  let maxConcurrentSounds = 8; // 最大同时播放音效数
  let activeSounds = [];
  async function loadBgm() {
    if (bgmLoaded || bgmLoading) return;
    ensureAudio(); if (!audioCtx) return;
    bgmLoading = true;
    
    // 尝试加载主音乐
    try {
      const res = await fetch('assets/bgm.mp3');
      if (!res.ok) throw new Error('bgm not found');
      const ab = await res.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(ab);
      bgmBuffer = buffer; bgmLoaded = true;
      if (musicEnabled) startMusic();
    } catch (e) {
      // fallback will be oscillator melody
    } finally {
      bgmLoading = false;
    }
    
    // 预加载其他音乐轨道
    loadAllMusicTracks();
  }
  
  async function loadAllMusicTracks() {
    const loadPromises = Object.entries(musicTracks).map(async ([name, url]) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
        
        const res = await fetch(url, { 
          signal: controller.signal,
          cache: 'force-cache' // 使用缓存
        });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const buffer = await audioCtx.decodeAudioData(ab);
          loadedTracks[name] = buffer;
          console.log(`🎵 音乐轨道加载成功: ${name} (${(ab.byteLength / 1024 / 1024).toFixed(1)}MB)`);
          return { name, success: true, size: ab.byteLength };
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        console.log(`❌ 音乐轨道加载失败: ${name} - ${e.message}`);
        return { name, success: false, error: e.message };
      }
    });
    
    // 并行加载所有轨道
    const results = await Promise.allSettled(loadPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const total = results.length;
    
    console.log(`🎼 音乐加载完成: ${successful}/${total} 成功`);
    
    // 如果没有成功加载任何轨道，启用程序化音乐
    if (successful === 0) {
      console.log('🎹 启用程序化音乐模式');
    }
  }
  
  function switchMusicTrack(trackName) {
    if (currentTrack === trackName) return;
    
    currentTrack = trackName;
    if (musicEnabled) {
      stopMusic();
      startMusic();
    }
  }
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        musicGain = audioCtx.createGain();
        sfxGain = audioCtx.createGain();
        musicGain.gain.value = musicVolume * 0.3; sfxGain.gain.value = sfxVolume * 0.8; masterGain.gain.value = 0.9;
        musicGain.connect(masterGain); sfxGain.connect(masterGain); masterGain.connect(audioCtx.destination);
      } catch (e) { audioEnabled = false; musicEnabled = false; }
    }
  }
  function playBeep(freq = 440, dur = 0.08, type = 'square', gain = 0.6) {
    if (!audioEnabled) return;
    ensureAudio(); if (!audioCtx) return;
    
    // 限制同时播放的音效数量以提高性能
    if (activeSounds.length >= maxConcurrentSounds) {
      // 停止最早的音效
      const oldestSound = activeSounds.shift();
      if (oldestSound && oldestSound.stop) {
        try { oldestSound.stop(); } catch(e) {}
      }
    }
    
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain(); 
    g.gain.value = gain * sfxVolume;
    osc.type = type; 
    osc.frequency.value = freq;
    osc.connect(g); 
    g.connect(sfxGain);
    
    const t = audioCtx.currentTime;
    osc.start(t);
    g.gain.setValueAtTime(gain * sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.stop(t + dur + 0.02);
    
    // 添加到活跃音效列表
    activeSounds.push(osc);
    
    // 自动清理
    setTimeout(() => {
      const index = activeSounds.indexOf(osc);
      if (index > -1) activeSounds.splice(index, 1);
    }, (dur + 0.02) * 1000);
  }
  const sfx = {
    jump: () => playBeep(620, 0.09, 'square', 0.55),
    doubleJump: () => { playBeep(740, 0.08, 'triangle', 0.5); setTimeout(() => playBeep(880, 0.06, 'triangle', 0.4), 40); },
    stomp: () => playBeep(180, 0.10, 'sawtooth', 0.6),
    death: () => { 
      playBeep(200, 0.2, 'sine', 0.7); 
      setTimeout(() => playBeep(120, 0.25, 'sine', 0.7), 120);
      setTimeout(() => playBeep(80, 0.3, 'sine', 0.6), 300);
    },
    win: () => { 
      playBeep(660, 0.12, 'triangle', 0.6); 
      setTimeout(() => playBeep(880, 0.16, 'triangle', 0.6), 140);
      setTimeout(() => playBeep(1100, 0.2, 'triangle', 0.7), 280);
    },
    coin: () => playBeep(1200, 0.06, 'square', 0.5),
    powerUp: () => {
      playBeep(523, 0.08, 'triangle', 0.6);
      setTimeout(() => playBeep(659, 0.08, 'triangle', 0.6), 80);
      setTimeout(() => playBeep(784, 0.08, 'triangle', 0.6), 160);
      setTimeout(() => playBeep(1047, 0.12, 'triangle', 0.7), 240);
    },
    star: () => {
      for(let i = 0; i < 8; i++) {
        setTimeout(() => playBeep(800 + i * 100, 0.05, 'triangle', 0.4), i * 30);
      }
    },
    gem: () => {
      playBeep(1200, 0.04, 'sine', 0.6);
      setTimeout(() => playBeep(1400, 0.04, 'sine', 0.5), 40);
      setTimeout(() => playBeep(1600, 0.06, 'sine', 0.4), 80);
    },
    combo: (comboCount) => {
      const baseFreq = 440 + (comboCount * 110);
      playBeep(baseFreq, 0.08, 'triangle', 0.6);
      setTimeout(() => playBeep(baseFreq * 1.5, 0.06, 'triangle', 0.5), 50);
    },
    levelComplete: () => {
      const melody = [523, 659, 784, 1047, 1319];
      melody.forEach((freq, i) => {
        setTimeout(() => playBeep(freq, 0.15, 'triangle', 0.6), i * 120);
      });
    },
    hurt: () => {
      playBeep(150, 0.15, 'sawtooth', 0.7);
      setTimeout(() => playBeep(100, 0.2, 'sawtooth', 0.6), 100);
    },
    loseLife: () => {
      playBeep(220, 0.3, 'sawtooth', 0.8);
      setTimeout(() => playBeep(180, 0.3, 'sawtooth', 0.7), 200);
      setTimeout(() => playBeep(140, 0.4, 'sawtooth', 0.6), 400);
    },
    gameOver: () => {
      playBeep(100, 0.5, 'sawtooth', 0.9);
      setTimeout(() => playBeep(80, 0.5, 'sawtooth', 0.8), 300);
      setTimeout(() => playBeep(60, 0.8, 'sawtooth', 0.7), 600);
    },
    powerDown: () => {
      playBeep(400, 0.1, 'square', 0.6);
      setTimeout(() => playBeep(300, 0.15, 'square', 0.5), 100);
      setTimeout(() => playBeep(200, 0.2, 'square', 0.4), 200);
    },
    enemyDefeat: () => playBeep(300, 0.08, 'square', 0.5),
    platformLand: () => playBeep(200, 0.05, 'sine', 0.3),
    toughHit: () => {
      playBeep(300, 0.12, 'sawtooth', 0.7);
      setTimeout(() => playBeep(260, 0.08, 'square', 0.5), 60);
    },
    toughKill: () => {
      playBeep(180, 0.15, 'sawtooth', 0.8);
      setTimeout(() => playBeep(220, 0.12, 'triangle', 0.7), 80);
      setTimeout(() => playBeep(330, 0.1, 'sine', 0.6), 160);
      setTimeout(() => playBeep(440, 0.08, 'triangle', 0.5), 240);
    },
    lifeRestore: () => {
      playBeep(440, 0.1, 'sine', 0.6);
      setTimeout(() => playBeep(523, 0.12, 'triangle', 0.6), 50);
      setTimeout(() => playBeep(659, 0.14, 'sine', 0.7), 100);
      setTimeout(() => playBeep(784, 0.16, 'triangle', 0.8), 150);
    },
    invincibilityBonus: () => {
      for(let i = 0; i < 6; i++) {
        setTimeout(() => playBeep(880 + i * 110, 0.06, 'triangle', 0.5), i * 40);
      }
    },
    milestone: () => {
      playBeep(659, 0.1, 'triangle', 0.7);
      setTimeout(() => playBeep(784, 0.1, 'triangle', 0.7), 80);
      setTimeout(() => playBeep(932, 0.12, 'triangle', 0.8), 160);
    },
    megaCombo: () => {
      const notes = [523, 659, 784, 1047, 1319, 1568];
      notes.forEach((freq, i) => {
        setTimeout(() => playBeep(freq, 0.08, 'triangle', 0.8), i * 60);
      });
    },
    // 新怪物音效
    bulletFire: () => {
      playBeep(800, 0.04, 'square', 0.4);
      setTimeout(() => playBeep(600, 0.03, 'sawtooth', 0.3), 20);
    },
    bulletHit: () => {
      playBeep(1000, 0.08, 'sine', 0.6);
      setTimeout(() => playBeep(1200, 0.06, 'triangle', 0.5), 40);
    },
    ghostAppear: () => {
      for(let i = 0; i < 5; i++) {
        setTimeout(() => playBeep(400 - i * 40, 0.1, 'sine', 0.3 - i * 0.05), i * 50);
      }
    },
    ghostVanish: () => {
      for(let i = 0; i < 4; i++) {
        setTimeout(() => playBeep(200 + i * 50, 0.08, 'triangle', 0.2), i * 30);
      }
    },
    spikedHit: () => {
      playBeep(150, 0.12, 'sawtooth', 0.8);
      setTimeout(() => playBeep(200, 0.08, 'square', 0.6), 60);
    },
    jumperLand: () => {
      playBeep(120, 0.15, 'square', 0.7);
      setTimeout(() => playBeep(180, 0.1, 'triangle', 0.5), 80);
    },
    miniSwarm: () => {
      for(let i = 0; i < 8; i++) {
        setTimeout(() => playBeep(1000 + i * 50, 0.03, 'square', 0.3), i * 15);
      }
    },
    // 环境音效
    levelStart: () => {
      playBeep(440, 0.1, 'triangle', 0.6);
      setTimeout(() => playBeep(554, 0.12, 'triangle', 0.7), 100);
      setTimeout(() => playBeep(659, 0.15, 'triangle', 0.8), 200);
    },
    checkpoint: () => {
      playBeep(523, 0.08, 'sine', 0.5);
      setTimeout(() => playBeep(659, 0.08, 'sine', 0.5), 80);
      setTimeout(() => playBeep(784, 0.1, 'sine', 0.6), 160);
    },
    dangerZone: () => {
      playBeep(200, 0.2, 'sawtooth', 0.4);
      setTimeout(() => playBeep(180, 0.2, 'sawtooth', 0.3), 150);
    },
    // UI音效
    buttonHover: () => playBeep(800, 0.03, 'sine', 0.2),
    buttonClick: () => playBeep(1000, 0.05, 'triangle', 0.4),
    menuOpen: () => {
      playBeep(659, 0.06, 'triangle', 0.5);
      setTimeout(() => playBeep(784, 0.08, 'triangle', 0.6), 60);
    },
    menuClose: () => {
      playBeep(784, 0.06, 'triangle', 0.5);
      setTimeout(() => playBeep(659, 0.08, 'triangle', 0.4), 60);
    },
    // 特殊效果音
    timeWarning: () => {
      for(let i = 0; i < 3; i++) {
        setTimeout(() => {
          playBeep(1200, 0.1, 'square', 0.6);
          setTimeout(() => playBeep(800, 0.1, 'square', 0.4), 50);
        }, i * 200);
      }
    },
    perfectLanding: () => {
      playBeep(880, 0.06, 'sine', 0.5);
      setTimeout(() => playBeep(1100, 0.08, 'triangle', 0.6), 40);
    },
    secretFound: () => {
      const melody = [659, 784, 880, 1047, 1319];
      melody.forEach((freq, i) => {
        setTimeout(() => playBeep(freq, 0.12, 'triangle', 0.7), i * 100);
      });
    }
  };
  function startMusic() {
    if (!musicEnabled) return;
    ensureAudio(); if (!audioCtx) return;
    stopMusic();
    
    // 尝试播放当前轨道
    const trackBuffer = loadedTracks[currentTrack] || bgmBuffer;
    
    if (trackBuffer) {
      bgmSource = audioCtx.createBufferSource();
      bgmSource.buffer = trackBuffer;
      bgmSource.loop = true;
      
      // 根据关卡主题应用音效
      const theme = getThemeForLevel(currentLevel);
      applyMusicTheme(theme);
      
      bgmSource.connect(musicGain);
      bgmSource.start();
      console.log(`播放音乐轨道: ${currentTrack}`);
    } else {
      // 增强的程序化音乐回退
      startProceduralMusic();
    }
  }
  
  function startProceduralMusic() {
      musicOsc = audioCtx.createOscillator();
    const g = audioCtx.createGain(); 
    g.gain.value = 0.08 * musicVolume;
    musicOsc.connect(g); 
    g.connect(musicGain);
    
    // 根据当前轨道选择不同的音乐风格
    const musicStyles = {
      main: { type: 'square', notes: [523, 659, 784, 659, 523, 659, 784, 880], tempo: 220 },
      underground: { type: 'sawtooth', notes: [392, 440, 494, 440, 392, 440, 494, 523], tempo: 280 },
      sky: { type: 'triangle', notes: [659, 784, 880, 1047, 880, 784, 659, 523], tempo: 180 },
      castle: { type: 'square', notes: [330, 392, 440, 523, 440, 392, 330, 294], tempo: 300 },
      boss: { type: 'sawtooth', notes: [220, 247, 294, 330, 294, 247, 220, 196], tempo: 150 }
    };
    
    const style = musicStyles[currentTrack] || musicStyles.main;
    musicOsc.type = style.type;
      musicOsc.start();
    
      let i = 0;
      musicInterval = setInterval(() => {
        if (!musicEnabled || !musicOsc) return;
      musicOsc.frequency.setValueAtTime(style.notes[i % style.notes.length], audioCtx.currentTime);
        i++;
    }, style.tempo);
    
    console.log(`播放程序化音乐: ${currentTrack} 风格`);
  }
  
  function getThemeForLevel(levelIdx) {
    if (levelIdx < 8) return 'grassland';
    if (levelIdx < 16) return 'underground';
    if (levelIdx < 24) return 'sky';
    if (levelIdx < 32) return 'castle';
    return 'final';
  }
  
  function getMusicTrackForLevel(levelIdx) {
    const theme = getThemeForLevel(levelIdx);
    const trackMap = {
      grassland: 'main',
      underground: 'underground',
      sky: 'sky',
      castle: 'castle',
      final: 'boss'
    };
    return trackMap[theme] || 'main';
  }
  
  function updateMusicForLevel(levelIdx) {
    const newTrack = getMusicTrackForLevel(levelIdx);
    if (newTrack !== currentTrack) {
      console.log(`关卡 ${levelIdx}: 切换音乐轨道从 ${currentTrack} 到 ${newTrack}`);
      switchMusicTrack(newTrack);
    }
  }
  
  // 音量控制函数
  function setMusicVolume(volume) {
    musicVolume = Math.max(0, Math.min(1, volume));
    if (musicGain) {
      musicGain.gain.value = musicVolume * 0.3;
    }
    localStorage.setItem('musicVolume', musicVolume);
  }
  
  function setSfxVolume(volume) {
    sfxVolume = Math.max(0, Math.min(1, volume));
    if (sfxGain) {
      sfxGain.gain.value = sfxVolume * 0.8;
    }
    localStorage.setItem('sfxVolume', sfxVolume);
  }
  
  function loadAudioSettings() {
    const savedMusicVolume = localStorage.getItem('musicVolume');
    const savedSfxVolume = localStorage.getItem('sfxVolume');
    const savedAudioEnabled = localStorage.getItem('audioEnabled');
    const savedMusicEnabled = localStorage.getItem('musicEnabled');
    const savedHapticEnabled = localStorage.getItem('hapticEnabled');
    
    if (savedMusicVolume !== null) musicVolume = parseFloat(savedMusicVolume);
    if (savedSfxVolume !== null) sfxVolume = parseFloat(savedSfxVolume);
    if (savedAudioEnabled !== null) audioEnabled = savedAudioEnabled === 'true';
    if (savedMusicEnabled !== null) musicEnabled = savedMusicEnabled === 'true';
    if (savedHapticEnabled !== null) hapticEnabled = savedHapticEnabled === 'true';
  }
  
  function saveAudioSettings() {
    localStorage.setItem('musicVolume', musicVolume);
    localStorage.setItem('sfxVolume', sfxVolume);
    localStorage.setItem('audioEnabled', audioEnabled);
    localStorage.setItem('musicEnabled', musicEnabled);
    localStorage.setItem('hapticEnabled', hapticEnabled);
  }
  
  function initAudioSettingsPanel() {
    // 音频设置按钮
    btnAudioSettings?.addEventListener('click', () => {
      sfx.menuOpen();
      audioSettingsPanel.style.display = 'flex';
      updateAudioSettingsDisplay();
    });
    
    // 关闭按钮
    closeAudioSettings?.addEventListener('click', () => {
      sfx.menuClose();
      audioSettingsPanel.style.display = 'none';
    });
    
    // 点击背景关闭
    audioSettingsPanel?.addEventListener('click', (e) => {
      if (e.target === audioSettingsPanel) {
        sfx.menuClose();
        audioSettingsPanel.style.display = 'none';
      }
    });
    
    // 音乐音量滑块
    musicVolumeSlider?.addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value) / 100;
      setMusicVolume(volume);
      if (musicVolumeDisplay) musicVolumeDisplay.textContent = `${e.target.value}%`;
    });
    
    // 音效音量滑块
    sfxVolumeSlider?.addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value) / 100;
      setSfxVolume(volume);
      if (sfxVolumeDisplay) sfxVolumeDisplay.textContent = `${e.target.value}%`;
    });
    
    // 音乐轨道选择
    musicTrackSelect?.addEventListener('change', (e) => {
      switchMusicTrack(e.target.value);
      sfx.buttonClick();
    });
    
    // 静音所有按钮
    toggleAllAudio?.addEventListener('click', () => {
      const allMuted = !audioEnabled && !musicEnabled;
      audioEnabled = allMuted;
      musicEnabled = allMuted;
      
      if (allMuted) {
        loadBgm();
        if (musicEnabled) startMusic();
      } else {
        stopMusic();
      }
      
      saveAudioSettings();
      updateAudioSettingsDisplay();
      updateMainButtons();
      sfx.buttonClick();
    });
    
    // 测试音效按钮
    testAudio?.addEventListener('click', () => {
      sfx.levelComplete();
      if (isMobile) triggerHaptic('success');
    });
    
    // 触觉反馈开关
    toggleHaptic?.addEventListener('click', () => {
      hapticEnabled = !hapticEnabled;
      saveAudioSettings();
      updateAudioSettingsDisplay();
      
      // 测试触觉反馈
      if (hapticEnabled && isMobile) {
        triggerHaptic('medium');
      }
      
      sfx.buttonClick();
    });
    
    // 重置设置按钮
    resetAudioSettings?.addEventListener('click', () => {
      musicVolume = 0.7;
      sfxVolume = 0.8;
      audioEnabled = true;
      musicEnabled = true;
      hapticEnabled = true;
      currentTrack = 'main';
      
      saveAudioSettings();
      updateAudioSettingsDisplay();
      updateMainButtons();
      
      if (musicGain) musicGain.gain.value = musicVolume * 0.3;
      if (sfxGain) sfxGain.gain.value = sfxVolume * 0.8;
      
      switchMusicTrack('main');
      sfx.buttonClick();
    });
  }
  
  function updateAudioSettingsDisplay() {
    if (musicVolumeSlider) musicVolumeSlider.value = Math.round(musicVolume * 100);
    if (sfxVolumeSlider) sfxVolumeSlider.value = Math.round(sfxVolume * 100);
    if (musicVolumeDisplay) musicVolumeDisplay.textContent = `${Math.round(musicVolume * 100)}%`;
    if (sfxVolumeDisplay) sfxVolumeDisplay.textContent = `${Math.round(sfxVolume * 100)}%`;
    if (musicTrackSelect) musicTrackSelect.value = currentTrack;
    
    if (toggleAllAudio) {
      const allMuted = !audioEnabled && !musicEnabled;
      toggleAllAudio.textContent = allMuted ? '🔊 开启所有' : '🔇 静音所有';
    }
    
    if (toggleHaptic) {
      toggleHaptic.textContent = hapticEnabled ? '📳 触觉开启' : '📳 触觉关闭';
      toggleHaptic.style.opacity = isMobile ? '1' : '0.5';
      toggleHaptic.disabled = !isMobile;
      if (!isMobile) {
        toggleHaptic.title = '仅在移动设备上可用';
      }
    }
  }
  
  function updateMainButtons() {
    if (btnAudio) btnAudio.textContent = `音效: ${audioEnabled ? '开' : '关'}`;
    if (btnMusic) btnMusic.textContent = `音乐: ${musicEnabled ? '开' : '关'}`;
  }
  
  function applyMusicTheme(theme) {
    if (!audioCtx || !musicGain) return;
    
    // Create theme-specific audio filters
    const filter = audioCtx.createBiquadFilter();
    const reverb = audioCtx.createConvolver();
    
    switch(theme) {
      case 'grassland':
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(100, audioCtx.currentTime);
        musicGain.gain.setValueAtTime(0.7, audioCtx.currentTime);
        break;
      case 'underground':
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, audioCtx.currentTime);
        musicGain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        break;
      case 'sky':
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(200, audioCtx.currentTime);
        musicGain.gain.setValueAtTime(0.8, audioCtx.currentTime);
        break;
      case 'castle':
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(600, audioCtx.currentTime);
        musicGain.gain.setValueAtTime(0.6, audioCtx.currentTime);
        break;
      case 'final':
        filter.type = 'allpass';
        musicGain.gain.setValueAtTime(0.9, audioCtx.currentTime);
        break;
    }
    
    // Connect the filter chain
    if (bgmSource) {
      bgmSource.disconnect();
      bgmSource.connect(filter);
      filter.connect(musicGain);
    }
  }
  
  function stopMusic() {
    if (musicInterval) { clearInterval(musicInterval); musicInterval = null; }
    if (musicOsc) { try { musicOsc.stop(); } catch(e) {} musicOsc.disconnect(); musicOsc = null; }
    if (bgmSource) { try { bgmSource.stop(); } catch(e) {} bgmSource.disconnect(); bgmSource = null; }
  }

  // Util
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Tile map (simple blocks). 32px tile.
  const TILE = 32;
  const world = {
    width: 200, height: 18, tiles: []
  };
  // Coins, power-ups and scoring
  let coins = 0; let score = 0;
  const coinTiles = new Set(); // indices: y*width + x
  const powerUps = []; // { x, y, r, type }
  
  // 新增游戏元素
  const particles = []; // 粒子效果
  const floatingPlatforms = []; // 浮动平台
  const movingEnemies = []; // 移动敌人
  const collectibles = []; // 收集品
  let playerSize = 1; // 玩家大小倍数
  let playerSpeed = 1; // 玩家速度倍数
  let invincible = false; // 无敌状态
  let invincibleTimer = 0; // 无敌时间
  let combo = 0; // 连击数
  let comboTimer = 0; // 连击计时器
  
  // 生命系统
  let lives = 3; // 当前生命数
  let maxLives = 3; // 最大生命数
  let gameOver = false; // 游戏结束状态
  function setTile(x, y, t) { world.tiles[y * world.width + x] = t; }
  function getTile(x, y) {
    // Treat bottom out-of-bounds as void (air) so player can fall into pits
    if (y >= world.height) return 0;
    // Left/right/top out-of-bounds remain solid to keep player within horizontal bounds
    if (x < 0 || y < 0 || x >= world.width) return 1;
    return world.tiles[y * world.width + x] || 0;
  }

  // Removed inline generator; levels are built from levelDefs

  // Player
  const player = {
    x: 3 * TILE, y: (world.height - 4) * TILE,
    w: 22, h: 28,
    vx: 0, vy: 0,
    onGround: false,
    alive: true,
    win: false,
    jumpCount: 0, // Track jumps for double jump
    maxJumps: 2   // Allow 2 jumps (ground + 1 air)
  };

  // Enemies (simple goombas)
  const enemies = [];
  function spawnGoomba(tx, ty, dir = -1) {
    enemies.push({ x: tx * TILE, y: ty * TILE - 20, w: 24, h: 20, vx: 60 * dir, alive: true });
  }
  function spawnSpiny(tx, ty, dir = -1) {
    // 带刺敌人：不能踩，碰到即死
    enemies.push({ x: tx * TILE, y: ty * TILE - 22, w: 24, h: 22, vx: 50 * dir, alive: true, spiny: true });
  }
  
  // 新增敌人类型
  function spawnFlyingEnemy(tx, ty) {
    // 飞行敌人：在空中飞行
    enemies.push({ 
      x: tx * TILE, y: ty * TILE - 40, w: 20, h: 16, 
      vx: 40, vy: 0, alive: true, flying: true,
      flyHeight: ty * TILE - 40, flyRange: 80
    });
  }
  
  function spawnBouncingEnemy(tx, ty) {
    // 弹跳敌人：会跳跃
    enemies.push({ 
      x: tx * TILE, 
      y: ty * TILE - TILE, // 提高生成位置
      w: 24, 
      h: 20, 
      vx: 30, 
      vy: 100, // 给初始向下速度
      alive: true, 
      bouncing: true,
      bounceTimer: 0, 
      bounceInterval: 2.0,
      onGround: false
    });
  }
  

  
  // 粒子系统
  function createParticle(x, y, vx, vy, color, life = 1.0) {
    particles.push({
      x, y, vx, vy, color, life, maxLife: life,
      size: Math.random() * 4 + 2
    });
  }
  
  // 浮动平台
  function createFloatingPlatform(x, y, w, h, moveX = 0, moveY = 0, speed = 1) {
    floatingPlatforms.push({
      x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE,
      startX: x * TILE, startY: y * TILE,
      moveX, moveY, speed, timer: 0
    });
  }
  
  // 收集品
  function createCollectible(x, y, type) {
    collectibles.push({
      x: x * TILE + 16, y: y * TILE + 16, r: 8, type,
      collected: false, bobTimer: 0
    });
  }
  // Multi-level definitions
  const levelDefs = [
    {
      width: 200,
      platforms: [ { x:8,y:12,w:6 }, { x:20,y:10,w:5 }, { x:32,y:9,w:4 }, { x:44,y:11,w:6 }, { x:62,y:8,w:8 }, { x:80,y:12,w:5 }, { x:100,y:9,w:7 }, { x:124,y:11,w:6 }, { x:148,y:10,w:10 }, { x:170,y:9,w:4 }, { x:185,y:11,w:6 } ],
      pits: [ [52,56], [56,60], [175,180] ],
      enemies: [ {type:'goomba',x:14}, {type:'goomba',x:26}, {type:'spiny',x:82}, {type:'goomba',x:118}, {type:'tough',x:50}, {type:'goomba',x:36}, {type:'flying',x:70,y:6}, {type:'goomba',x:102}, {type:'bouncing',x:135}, {type:'goomba',x:165}, {type:'tough',x:180} ],
      coins: [ [12,11], [22,9], [46,11], [90,11], [120,10], [140,9], [35,8], [66,7], [78,11], [106,8], [130,10], [152,9], [172,8], [188,10], [15,10], [28,8], [38,7], [52,10], [68,9], [84,8], [96,7], [110,9], [126,8], [144,7], [158,10], [176,9], [192,8] ],
      powerUps: [ {x:34,y:8,type:'mushroom'}, {x:110,y:8,type:'mushroom'}, {x:74,y:7,type:'mushroom'}, {x:155,y:9,type:'mushroom'} ]
    },
    {
      width: 230,
      platforms: [ { x:10,y:12,w:8 }, { x:28,y:10,w:6 }, { x:46,y:8,w:8 }, { x:70,y:11,w:10 }, { x:96,y:9,w:7 }, { x:128,y:8,w:9 }, { x:160,y:10,w:6 }, { x:180,y:7,w:8 }, { x:210,y:11,w:8 } ],
      pits: [ [60,66], [100,104], [150,154], [190,196] ],
      enemies: [ {type:'goomba',x:18}, {type:'spiny',x:36}, {type:'goomba',x:68}, {type:'goomba',x:92}, {type:'spiny',x:120}, {type:'goomba',x:146}, {type:'spiny',x:172}, {type:'goomba',x:198}, {type:'flying',x:40,y:5}, {type:'bouncing',x:165}, {type:'tough',x:80}, {type:'tough',x:210}, {type:'goomba',x:24}, {type:'flying',x:55,y:7}, {type:'goomba',x:78}, {type:'bouncing',x:105}, {type:'goomba',x:135}, {type:'flying',x:185,y:6}, {type:'tough',x:155} ],
      coins: [ [20,11], [44,9], [72,10], [108,8], [144,10], [180,10], [200,9], [14,11], [30,9], [50,7], [98,8], [132,7], [166,9], [184,6], [214,10], [25,10], [88,10], [16,10], [38,8], [58,9], [84,7], [116,9], [138,8], [162,7], [192,9], [220,10], [35,7], [65,8], [95,6] ],
      powerUps: [ {x:72,y:9,type:'mushroom'}, {x:155,y:9,type:'mushroom'}, {x:48,y:7,type:'lifeMushroom'}, {x:130,y:7,type:'mushroom'}, {x:200,y:6,type:'star'} ]
    },
    {
      width: 260,
      platforms: [ { x:14,y:11,w:10 }, { x:38,y:9,w:10 }, { x:64,y:8,w:8 }, { x:92,y:10,w:10 }, { x:128,y:9,w:10 }, { x:168,y:8,w:12 }, { x:210,y:10,w:8 }, { x:235,y:7,w:6 }, { x:248,y:11,w:8 } ],
      pits: [ [56,64], [116,122], [186,192], [222,228] ],
      enemies: [ {type:'spiny',x:22}, {type:'goomba',x:40}, {type:'goomba',x:58}, {type:'spiny',x:88}, {type:'goomba',x:114}, {type:'spiny',x:136}, {type:'goomba',x:164}, {type:'spiny',x:182}, {type:'goomba',x:208}, {type:'spiny',x:236}, {type:'flying',x:45,y:6}, {type:'flying',x:95,y:5}, {type:'bouncing',x:125}, {type:'bouncing',x:195}, {type:'tough',x:70}, {type:'tough',x:150}, {type:'tough',x:220}, {type:'goomba',x:28}, {type:'flying',x:75,y:7}, {type:'spiny',x:105}, {type:'bouncing',x:140}, {type:'flying',x:175,y:4}, {type:'goomba',x:200}, {type:'tough',x:180}, {type:'flying',x:250,y:6} ],
      coins: [ [18,10], [42,8], [74,7], [102,9], [138,8], [176,7], [216,9], [244,9], [20,10], [46,8], [68,7], [96,9], [132,8], [172,7], [214,9], [240,6], [252,10], [32,8], [85,9], [145,8], [200,9], [25,9], [52,7], [78,6], [115,8], [155,7], [185,6], [225,8], [35,6], [62,5], [125,7], [165,6], [195,5], [235,7] ],
      powerUps: [ {x:138,y:8,type:'mushroom'}, {x:200,y:9,type:'mushroom'}, {x:245,y:6,type:'mushroom'}, {x:75,y:6,type:'mushroom'}, {x:170,y:6,type:'star'}, {x:230,y:7,type:'gem'} ]
    },
    {
      width: 280,
      platforms: [ { x:12,y:11,w:8 }, { x:30,y:9,w:6 }, { x:50,y:7,w:8 }, { x:78,y:10,w:10 }, { x:108,y:8,w:8 }, { x:140,y:6,w:12 }, { x:172,y:9,w:10 }, { x:210,y:7,w:8 }, { x:240,y:10,w:8 } ],
      pits: [ [70,78], [120,128], [180,188], [220,228], [260,268] ],
      enemies: [ {type:'spiny',x:20}, {type:'goomba',x:38}, {type:'spiny',x:56}, {type:'goomba',x:84}, {type:'spiny',x:102}, {type:'goomba',x:130}, {type:'spiny',x:158}, {type:'goomba',x:186}, {type:'spiny',x:214}, {type:'goomba',x:242}, {type:'spiny',x:270} ],
      coins: [ [16,10], [36,8], [54,6], [82,9], [112,7], [144,5], [176,8], [214,6], [244,9], [272,9] ],
      powerUps: [ {x:54,y:6,type:'mushroom'}, {x:176,y:7,type:'mushroom'} ]
    },
    {
      width: 300,
      platforms: [ { x:15,y:10,w:10 }, { x:35,y:8,w:8 }, { x:55,y:6,w:10 }, { x:85,y:9,w:12 }, { x:115,y:7,w:8 }, { x:145,y:5,w:10 }, { x:175,y:8,w:10 }, { x:205,y:6,w:8 }, { x:235,y:9,w:10 }, { x:265,y:7,w:8 } ],
      pits: [ [75,85], [135,145], [195,205], [255,265] ],
      enemies: [ {type:'goomba',x:25}, {type:'spiny',x:43}, {type:'goomba',x:63}, {type:'spiny',x:93}, {type:'goomba',x:123}, {type:'spiny',x:153}, {type:'goomba',x:183}, {type:'spiny',x:213}, {type:'goomba',x:243}, {type:'spiny',x:273} ],
      coins: [ [20,9], [40,7], [60,5], [90,8], [120,6], [150,4], [180,7], [210,5], [240,8], [270,6] ],
      powerUps: [ {x:60,y:5,type:'mushroom'}, {x:150,y:4,type:'mushroom'} ]
    },
    {
      width: 320,
      platforms: [ { x:10,y:11,w:8 }, { x:30,y:9,w:6 }, { x:50,y:7,w:8 }, { x:80,y:10,w:10 }, { x:110,y:8,w:6 }, { x:140,y:6,w:8 }, { x:170,y:9,w:10 }, { x:200,y:7,w:8 }, { x:230,y:5,w:10 }, { x:260,y:8,w:8 }, { x:290,y:10,w:6 } ],
      pits: [ [70,80], [130,140], [190,200], [250,260], [300,310] ],
      enemies: [ {type:'spiny',x:18}, {type:'goomba',x:36}, {type:'spiny',x:56}, {type:'goomba',x:86}, {type:'spiny',x:116}, {type:'goomba',x:146}, {type:'spiny',x:176}, {type:'goomba',x:206}, {type:'spiny',x:236}, {type:'goomba',x:266}, {type:'spiny',x:296} ],
      coins: [ [14,10], [34,8], [54,6], [84,9], [114,7], [144,5], [174,8], [204,6], [234,4], [264,7], [294,9] ],
      powerUps: [ {x:54,y:6,type:'mushroom'}, {x:174,y:7,type:'mushroom'}, {x:234,y:4,type:'mushroom'} ]
    },
    {
      width: 340,
      platforms: [ { x:12,y:10,w:10 }, { x:32,y:8,w:8 }, { x:52,y:6,w:10 }, { x:82,y:9,w:12 }, { x:112,y:7,w:8 }, { x:142,y:5,w:10 }, { x:172,y:8,w:10 }, { x:202,y:6,w:8 }, { x:232,y:4,w:10 }, { x:262,y:7,w:8 }, { x:292,y:9,w:10 }, { x:322,y:6,w:6 } ],
      pits: [ [72,82], [132,142], [192,202], [252,262], [312,322] ],
      enemies: [ {type:'goomba',x:22}, {type:'spiny',x:40}, {type:'goomba',x:60}, {type:'spiny',x:90}, {type:'goomba',x:120}, {type:'spiny',x:150}, {type:'goomba',x:180}, {type:'spiny',x:210}, {type:'goomba',x:240}, {type:'spiny',x:270}, {type:'goomba',x:300}, {type:'spiny',x:330} ],
      coins: [ [18,9], [38,7], [58,5], [88,8], [118,6], [148,4], [178,7], [208,5], [238,3], [268,6], [298,8], [328,5] ],
      powerUps: [ {x:58,y:5,type:'mushroom'}, {x:148,y:4,type:'mushroom'}, {x:238,y:3,type:'mushroom'} ]
    },
    {
      width: 360,
      platforms: [ { x:15,y:9,w:8 }, { x:35,y:7,w:6 }, { x:55,y:5,w:8 }, { x:85,y:8,w:10 }, { x:115,y:6,w:8 }, { x:145,y:4,w:10 }, { x:175,y:7,w:10 }, { x:205,y:5,w:8 }, { x:235,y:3,w:10 }, { x:265,y:6,w:8 }, { x:295,y:8,w:10 }, { x:325,y:5,w:8 }, { x:345,y:7,w:6 } ],
      pits: [ [75,85], [135,145], [195,205], [255,265], [315,325], [335,345] ],
      enemies: [ {type:'spiny',x:25}, {type:'goomba',x:43}, {type:'spiny',x:63}, {type:'goomba',x:93}, {type:'spiny',x:123}, {type:'goomba',x:153}, {type:'spiny',x:183}, {type:'goomba',x:213}, {type:'spiny',x:243}, {type:'goomba',x:273}, {type:'spiny',x:303}, {type:'goomba',x:333}, {type:'spiny',x:353} ],
      coins: [ [20,8], [40,6], [60,4], [90,7], [120,5], [150,3], [180,6], [210,4], [240,2], [270,5], [300,7], [330,4], [350,6] ],
      powerUps: [ {x:60,y:4,type:'mushroom'}, {x:150,y:3,type:'mushroom'}, {x:240,y:2,type:'mushroom'}, {x:330,y:4,type:'mushroom'} ]
    },
    // 2-1: 地下洞穴主题
    {
      width: 380,
      platforms: [ { x:8,y:13,w:12 }, { x:25,y:11,w:8 }, { x:40,y:9,w:6 }, { x:55,y:12,w:10 }, { x:75,y:10,w:8 }, { x:95,y:8,w:6 }, { x:115,y:11,w:12 }, { x:140,y:9,w:8 }, { x:160,y:7,w:10 }, { x:185,y:10,w:8 }, { x:210,y:8,w:12 }, { x:240,y:11,w:10 }, { x:270,y:9,w:8 }, { x:295,y:12,w:10 }, { x:320,y:10,w:8 }, { x:345,y:8,w:10 } ],
      pits: [ [70,75], [110,115], [175,180], [235,240], [290,295], [340,345] ],
      enemies: [ {type:'goomba',x:12}, {type:'spiny',x:28}, {type:'flying',x:50,y:6}, {type:'goomba',x:120}, {type:'spiny',x:165}, {type:'goomba',x:220}, {type:'tough',x:80}, {type:'tough',x:190}, {type:'tough',x:300}, {type:'goomba',x:35}, {type:'bouncing',x:65}, {type:'flying',x:100,y:5}, {type:'spiny',x:140}, {type:'goomba',x:175}, {type:'flying',x:205,y:7}, {type:'bouncing',x:245}, {type:'spiny',x:280}, {type:'tough',x:250}, {type:'flying',x:320,y:4}, {type:'goomba',x:350} ],
      coins: [ [15,12], [30,10], [45,8], [60,11], [85,9], [125,10], [155,6], [195,9], [225,7], [255,10], [285,8], [315,9], [350,7], [18,11], [42,7], [68,9], [92,7], [118,10], [145,8], [168,6], [188,9], [215,7], [242,10], [268,8], [298,11], [325,9], [20,10], [52,6], [105,6], [172,5], [205,6], [275,7], [335,8], [360,6] ],
      powerUps: [ {x:45,y:8,type:'lifeMushroom'}, {x:155,y:6,type:'mushroom'}, {x:285,y:8,type:'mushroom'}, {x:105,y:7,type:'mushroom'}, {x:225,y:6,type:'star'}, {x:325,y:8,type:'gem'}, {x:365,y:7,type:'lifeMushroom'} ]
    },
    // 2-2: 天空之城
    {
      width: 400,
      platforms: [ { x:10,y:14,w:8 }, { x:25,y:12,w:6 }, { x:38,y:10,w:8 }, { x:55,y:8,w:6 }, { x:70,y:6,w:10 }, { x:90,y:11,w:8 }, { x:110,y:9,w:6 }, { x:125,y:7,w:12 }, { x:150,y:5,w:8 }, { x:170,y:8,w:10 }, { x:195,y:11,w:8 }, { x:215,y:9,w:6 }, { x:235,y:7,w:10 }, { x:260,y:10,w:8 }, { x:280,y:8,w:12 }, { x:310,y:6,w:8 }, { x:330,y:9,w:10 }, { x:355,y:7,w:8 } ],
      pits: [ [48,55], [100,110], [160,170], [225,235], [300,310], [350,355] ],
      enemies: [ {type:'flying',x:20,y:5}, {type:'goomba',x:35}, {type:'spiny',x:60}, {type:'flying',x:85,y:4}, {type:'bouncing',x:115}, {type:'goomba',x:140}, {type:'flying',x:175,y:6}, {type:'spiny',x:200}, {type:'bouncing',x:240}, {type:'flying',x:285,y:5}, {type:'goomba',x:325}, {type:'spiny',x:365} ],
      coins: [ [14,13], [30,11], [42,9], [60,7], [75,5], [95,10], [130,6], [155,4], [175,7], [200,10], [240,6], [265,9], [315,5], [340,8], [360,6] ],
      powerUps: [ {x:75,y:5,type:'mushroom'}, {x:155,y:4,type:'mushroom'}, {x:315,y:5,type:'mushroom'} ]
    },
    // 2-3: 火山地带
    {
      width: 420,
      platforms: [ { x:12,y:13,w:10 }, { x:30,y:11,w:8 }, { x:50,y:9,w:6 }, { x:68,y:7,w:10 }, { x:90,y:12,w:8 }, { x:110,y:10,w:6 }, { x:128,y:8,w:12 }, { x:155,y:6,w:8 }, { x:175,y:11,w:10 }, { x:200,y:9,w:8 }, { x:225,y:7,w:6 }, { x:245,y:12,w:10 }, { x:270,y:10,w:8 }, { x:295,y:8,w:12 }, { x:325,y:6,w:8 }, { x:350,y:9,w:10 }, { x:380,y:11,w:8 } ],
      pits: [ [78,90], [140,155], [190,200], [260,270], [320,325], [370,380] ],
      enemies: [ {type:'spiny',x:18}, {type:'flying',x:40,y:6}, {type:'bouncing',x:75}, {type:'goomba',x:115}, {type:'spiny',x:160}, {type:'flying',x:185,y:4}, {type:'bouncing',x:230}, {type:'goomba',x:280}, {type:'spiny',x:330}, {type:'flying',x:365,y:5}, {type:'bouncing',x:395} ],
      coins: [ [17,12], [35,10], [55,8], [73,6], [95,11], [135,7], [160,5], [180,10], [205,8], [250,11], [275,9], [300,7], [330,5], [355,8], [385,10] ],
      powerUps: [ {x:73,y:6,type:'mushroom'}, {x:160,y:5,type:'mushroom'}, {x:330,y:5,type:'mushroom'} ]
    },
    // 2-4: 冰雪王国
    {
      width: 440,
      platforms: [ { x:15,y:12,w:12 }, { x:35,y:10,w:8 }, { x:55,y:8,w:10 }, { x:78,y:11,w:8 }, { x:100,y:9,w:6 }, { x:120,y:7,w:12 }, { x:145,y:12,w:10 }, { x:170,y:10,w:8 }, { x:195,y:8,w:6 }, { x:215,y:6,w:10 }, { x:240,y:11,w:8 }, { x:265,y:9,w:12 }, { x:295,y:7,w:8 }, { x:320,y:12,w:10 }, { x:350,y:10,w:8 }, { x:375,y:8,w:12 }, { x:405,y:11,w:8 } ],
      pits: [ [88,100], [160,170], [230,240], [310,320], [365,375], [400,405] ],
      enemies: [ {type:'flying',x:25,y:5}, {type:'spiny',x:45}, {type:'bouncing',x:85}, {type:'goomba',x:125}, {type:'flying',x:155,y:7}, {type:'spiny',x:180}, {type:'bouncing',x:220}, {type:'goomba',x:270}, {type:'flying',x:305,y:4}, {type:'spiny',x:340}, {type:'bouncing',x:385}, {type:'goomba',x:420} ],
      coins: [ [20,11], [40,9], [60,7], [83,10], [105,8], [125,6], [150,11], [175,9], [200,7], [220,5], [245,10], [270,8], [300,6], [325,11], [355,9], [380,7], [410,10] ],
      powerUps: [ {x:60,y:7,type:'mushroom'}, {x:200,y:7,type:'mushroom'}, {x:380,y:7,type:'mushroom'} ]
    },
    // 2-5: 沙漠绿洲
    {
      width: 460,
      platforms: [ { x:10,y:13,w:8 }, { x:28,y:11,w:10 }, { x:50,y:9,w:8 }, { x:70,y:7,w:6 }, { x:90,y:12,w:12 }, { x:120,y:10,w:8 }, { x:145,y:8,w:10 }, { x:170,y:6,w:8 }, { x:195,y:11,w:6 }, { x:220,y:9,w:12 }, { x:250,y:7,w:8 }, { x:275,y:12,w:10 }, { x:305,y:10,w:8 }, { x:330,y:8,w:6 }, { x:355,y:6,w:12 }, { x:385,y:11,w:8 }, { x:415,y:9,w:10 } ],
      pits: [ [78,90], [160,170], [240,250], [320,330], [375,385], [425,435] ],
      enemies: [ {type:'goomba',x:15}, {type:'flying',x:35,y:6}, {type:'spiny',x:60}, {type:'bouncing',x:125}, {type:'goomba',x:155}, {type:'flying',x:185,y:4}, {type:'spiny',x:225}, {type:'bouncing',x:280}, {type:'goomba',x:315}, {type:'flying',x:345,y:5}, {type:'spiny',x:390}, {type:'bouncing',x:430} ],
      coins: [ [18,12], [33,10], [55,8], [75,6], [95,11], [125,9], [150,7], [175,5], [200,10], [225,8], [255,6], [280,11], [310,9], [335,7], [360,5], [390,10], [420,8] ],
      powerUps: [ {x:75,y:6,type:'mushroom'}, {x:175,y:5,type:'mushroom'}, {x:360,y:5,type:'mushroom'} ]
    },
    // 2-6: 森林迷境
    {
      width: 480,
      platforms: [ { x:12,y:12,w:10 }, { x:32,y:10,w:8 }, { x:52,y:8,w:12 }, { x:78,y:11,w:8 }, { x:100,y:9,w:10 }, { x:125,y:7,w:8 }, { x:150,y:12,w:6 }, { x:175,y:10,w:12 }, { x:205,y:8,w:8 }, { x:230,y:6,w:10 }, { x:255,y:11,w:8 }, { x:280,y:9,w:12 }, { x:310,y:7,w:8 }, { x:335,y:12,w:10 }, { x:365,y:10,w:8 }, { x:390,y:8,w:12 }, { x:420,y:11,w:8 }, { x:450,y:9,w:10 } ],
      pits: [ [90,100], [165,175], [245,255], [325,335], [385,390], [445,450] ],
      enemies: [ {type:'flying',x:20,y:7}, {type:'spiny',x:40}, {type:'bouncing',x:85}, {type:'goomba',x:130}, {type:'flying',x:160,y:5}, {type:'spiny',x:185}, {type:'bouncing',x:235}, {type:'goomba',x:285}, {type:'flying',x:320,y:6}, {type:'spiny',x:350}, {type:'bouncing',x:405}, {type:'goomba',x:460} ],
      coins: [ [17,11], [37,9], [57,7], [83,10], [105,8], [130,6], [155,11], [180,9], [210,7], [235,5], [260,10], [285,8], [315,6], [340,11], [370,9], [395,7], [425,10], [455,8] ],
      powerUps: [ {x:57,y:7,type:'mushroom'}, {x:210,y:7,type:'mushroom'}, {x:395,y:7,type:'mushroom'} ]
    },
    // 2-7: 魔法城堡
    {
      width: 500,
      platforms: [ { x:8,y:13,w:12 }, { x:28,y:11,w:10 }, { x:50,y:9,w:8 }, { x:72,y:7,w:12 }, { x:100,y:12,w:8 }, { x:125,y:10,w:10 }, { x:150,y:8,w:8 }, { x:175,y:6,w:12 }, { x:205,y:11,w:8 }, { x:230,y:9,w:10 }, { x:255,y:7,w:8 }, { x:280,y:12,w:12 }, { x:310,y:10,w:8 }, { x:335,y:8,w:10 }, { x:365,y:6,w:8 }, { x:390,y:11,w:12 }, { x:420,y:9,w:8 }, { x:450,y:7,w:10 }, { x:475,y:12,w:8 } ],
      pits: [ [90,100], [165,175], [245,255], [325,335], [385,390], [465,475] ],
      enemies: [ {type:'spiny',x:15}, {type:'flying',x:35,y:6}, {type:'bouncing',x:80}, {type:'goomba',x:130}, {type:'flying',x:160,y:4}, {type:'spiny',x:185}, {type:'bouncing',x:235}, {type:'goomba',x:290}, {type:'flying',x:320,y:7}, {type:'spiny',x:350}, {type:'bouncing',x:405}, {type:'goomba',x:460}, {type:'flying',x:485,y:5} ],
      coins: [ [14,12], [33,10], [55,8], [77,6], [105,11], [130,9], [155,7], [180,5], [210,10], [235,8], [260,6], [285,11], [315,9], [340,7], [370,5], [395,10], [425,8], [455,6], [480,11] ],
      powerUps: [ {x:77,y:6,type:'mushroom'}, {x:180,y:5,type:'mushroom'}, {x:370,y:5,type:'mushroom'} ]
    },
    // 2-8: 终极挑战
    {
      width: 520,
      platforms: [ { x:10,y:12,w:10 }, { x:30,y:10,w:8 }, { x:50,y:8,w:12 }, { x:78,y:6,w:8 }, { x:105,y:11,w:10 }, { x:130,y:9,w:8 }, { x:155,y:7,w:12 }, { x:185,y:5,w:8 }, { x:215,y:10,w:10 }, { x:245,y:8,w:8 }, { x:270,y:6,w:12 }, { x:300,y:11,w:8 }, { x:325,y:9,w:10 }, { x:355,y:7,w:8 }, { x:380,y:5,w:12 }, { x:410,y:10,w:8 }, { x:435,y:8,w:10 }, { x:465,y:6,w:8 }, { x:490,y:11,w:12 } ],
      pits: [ [95,105], [175,185], [260,270], [350,355], [425,435], [485,490] ],
      enemies: [ {type:'flying',x:18,y:5}, {type:'spiny',x:38}, {type:'bouncing',x:85}, {type:'goomba',x:135}, {type:'flying',x:170,y:3}, {type:'spiny',x:195}, {type:'bouncing',x:250}, {type:'goomba',x:310}, {type:'flying',x:340,y:6}, {type:'spiny',x:370}, {type:'bouncing',x:420}, {type:'goomba',x:475}, {type:'flying',x:505,y:4} ],
      coins: [ [15,11], [35,9], [55,7], [83,5], [110,10], [135,8], [160,6], [190,4], [220,9], [250,7], [275,5], [305,10], [330,8], [360,6], [385,4], [415,9], [440,7], [470,5], [495,10] ],
      powerUps: [ {x:83,y:5,type:'mushroom'}, {x:190,y:4,type:'mushroom'}, {x:385,y:4,type:'mushroom'}, {x:495,y:10,type:'mushroom'} ]
    },
    // 3-1: 深海探险
    {
      width: 540,
      platforms: [ { x:8,y:14,w:12 }, { x:28,y:12,w:10 }, { x:48,y:10,w:8 }, { x:70,y:8,w:12 }, { x:98,y:13,w:10 }, { x:125,y:11,w:8 }, { x:150,y:9,w:12 }, { x:180,y:7,w:8 }, { x:210,y:12,w:10 }, { x:240,y:10,w:8 }, { x:265,y:8,w:12 }, { x:295,y:6,w:8 }, { x:325,y:11,w:10 }, { x:355,y:9,w:8 }, { x:380,y:7,w:12 }, { x:410,y:12,w:10 }, { x:440,y:10,w:8 }, { x:470,y:8,w:12 }, { x:500,y:13,w:8 } ],
      pits: [ [88,98], [170,180], [255,265], [345,355], [430,440], [490,500] ],
      enemies: [ {type:'goomba',x:15}, {type:'flying',x:35,y:7}, {type:'spiny',x:55}, {type:'goomba',x:140}, {type:'spiny',x:190}, {type:'goomba',x:315}, {type:'tough',x:100}, {type:'tough',x:250}, {type:'tough',x:400}, {type:'tough',x:480}, {type:'bouncing',x:25}, {type:'flying',x:75,y:5}, {type:'goomba',x:115}, {type:'spiny',x:165}, {type:'bouncing',x:210}, {type:'flying',x:270,y:6}, {type:'goomba',x:295}, {type:'spiny',x:340}, {type:'tough',x:370}, {type:'flying',x:420,y:4}, {type:'bouncing',x:450}, {type:'goomba',x:500}, {type:'tough',x:520} ],
      coins: [ [13,13], [33,11], [53,9], [75,7], [103,12], [130,10], [155,8], [185,6], [215,11], [245,9], [270,7], [300,5], [330,10], [360,8], [385,6], [415,11], [445,9], [475,7], [505,12], [18,12], [45,8], [63,7], [95,11], [118,9], [145,7], [175,5], [195,10], [225,8], [255,6], [285,4], [315,9], [345,7], [375,5], [405,10], [425,8], [455,6], [485,11], [22,11], [58,6], [85,10], [125,8], [165,6], [205,9], [235,7], [275,5], [305,8], [365,6], [395,4], [435,9], [465,7], [495,10] ],
      powerUps: [ {x:75,y:7,type:'mushroom'}, {x:185,y:6,type:'mushroom'}, {x:385,y:6,type:'mushroom'}, {x:505,y:12,type:'mushroom'}, {x:130,y:9,type:'mushroom'}, {x:270,y:6,type:'star'}, {x:330,y:9,type:'gem'}, {x:445,y:8,type:'mushroom'}, {x:300,y:4,type:'star'} ]
    },
    // 3-2到3-8: 继续添加更多挑战性关卡...
    {
      width: 560,
      platforms: [ { x:12,y:12,w:12 }, { x:30,y:10,w:10 }, { x:50,y:8,w:8 }, { x:70,y:6,w:12 }, { x:95,y:11,w:10 }, { x:115,y:9,w:8 }, { x:135,y:7,w:12 }, { x:160,y:5,w:8 }, { x:180,y:10,w:10 }, { x:200,y:8,w:8 }, { x:220,y:6,w:12 }, { x:245,y:11,w:8 }, { x:265,y:9,w:10 }, { x:285,y:7,w:8 }, { x:305,y:5,w:12 }, { x:330,y:10,w:10 }, { x:350,y:8,w:8 }, { x:370,y:6,w:12 }, { x:395,y:11,w:10 } ],
      pits: [ [85,95], [150,160], [235,245], [275,285], [360,370], [410,420] ],
      enemies: [ {type:'flying',x:20,y:6}, {type:'spiny',x:42}, {type:'bouncing',x:82}, {type:'goomba',x:120}, {type:'flying',x:145,y:4}, {type:'spiny',x:170}, {type:'bouncing',x:195}, {type:'goomba',x:225}, {type:'flying',x:260,y:7}, {type:'spiny',x:295}, {type:'bouncing',x:325}, {type:'goomba',x:355}, {type:'flying',x:385,y:5}, {type:'spiny',x:410} ],
      coins: [ [17,11], [35,9], [55,7], [75,5], [100,10], [120,8], [140,6], [165,4], [185,9], [205,7], [225,5], [250,10], [270,8], [290,6], [310,4], [335,9], [355,7], [375,5], [400,10] ],
      powerUps: [ {x:75,y:5,type:'mushroom'}, {x:165,y:4,type:'mushroom'}, {x:310,y:4,type:'mushroom'}, {x:400,y:10,type:'mushroom'} ]
    },
    {
      width: 580,
      platforms: [ { x:10,y:14,w:12 }, { x:30,y:12,w:10 }, { x:52,y:10,w:8 }, { x:75,y:8,w:12 }, { x:100,y:6,w:8 }, { x:125,y:11,w:14 }, { x:155,y:9,w:10 }, { x:180,y:7,w:8 }, { x:205,y:5,w:12 }, { x:235,y:10,w:8 }, { x:260,y:8,w:14 }, { x:290,y:6,w:10 }, { x:320,y:12,w:8 }, { x:345,y:10,w:12 }, { x:375,y:8,w:8 }, { x:400,y:6,w:14 }, { x:430,y:11,w:10 }, { x:460,y:9,w:8 }, { x:485,y:7,w:12 }, { x:515,y:12,w:8 }, { x:540,y:10,w:14 } ],
      pits: [ [115,125], [195,205], [280,290], [365,375], [450,460], [525,535] ],
      enemies: [ {type:'spiny',x:18}, {type:'flying',x:38,y:7}, {type:'bouncing',x:80}, {type:'goomba',x:130}, {type:'flying',x:170,y:5}, {type:'spiny',x:190}, {type:'bouncing',x:240}, {type:'goomba',x:295}, {type:'flying',x:330,y:8}, {type:'spiny',x:360}, {type:'bouncing',x:415}, {type:'goomba',x:475}, {type:'flying',x:500,y:6}, {type:'spiny',x:525}, {type:'bouncing',x:555} ],
      coins: [ [15,13], [35,11], [57,9], [80,7], [105,5], [130,10], [160,8], [185,6], [210,4], [240,9], [265,7], [295,5], [325,11], [350,9], [380,7], [405,5], [435,10], [465,8], [490,6], [520,11], [545,9] ],
      powerUps: [ {x:80,y:7,type:'mushroom'}, {x:210,y:4,type:'mushroom'}, {x:405,y:5,type:'mushroom'}, {x:545,y:9,type:'mushroom'} ]
    },
    {
      width: 600,
      platforms: [ { x:8,y:13,w:14 }, { x:28,y:11,w:12 }, { x:50,y:9,w:10 }, { x:75,y:7,w:8 }, { x:100,y:12,w:14 }, { x:130,y:10,w:12 }, { x:155,y:8,w:10 }, { x:180,y:6,w:8 }, { x:210,y:11,w:14 }, { x:240,y:9,w:12 }, { x:265,y:7,w:10 }, { x:290,y:5,w:8 }, { x:320,y:10,w:14 }, { x:350,y:8,w:12 }, { x:375,y:6,w:10 }, { x:405,y:11,w:8 }, { x:435,y:9,w:14 }, { x:465,y:7,w:12 }, { x:490,y:12,w:10 }, { x:520,y:10,w:8 }, { x:550,y:8,w:14 } ],
      pits: [ [90,100], [200,210], [285,290], [395,405], [485,490], [545,550] ],
      enemies: [ {type:'flying',x:16,y:8}, {type:'spiny',x:36}, {type:'bouncing',x:65}, {type:'goomba',x:120}, {type:'flying',x:150,y:6}, {type:'spiny',x:170}, {type:'bouncing',x:220}, {type:'goomba',x:275}, {type:'flying',x:310,y:4}, {type:'spiny',x:335}, {type:'bouncing',x:380}, {type:'goomba',x:425}, {type:'flying',x:455,y:7}, {type:'spiny',x:480}, {type:'bouncing',x:510}, {type:'goomba',x:565} ],
      coins: [ [13,12], [33,10], [55,8], [80,6], [105,11], [135,9], [160,7], [185,5], [215,10], [245,8], [270,6], [295,4], [325,9], [355,7], [380,5], [410,10], [440,8], [470,6], [495,11], [525,9], [555,7] ],
      powerUps: [ {x:80,y:6,type:'mushroom'}, {x:185,y:5,type:'mushroom'}, {x:380,y:5,type:'mushroom'}, {x:555,y:7,type:'mushroom'} ]
    },
    {
      width: 620,
      platforms: [ { x:10,y:12,w:16 }, { x:32,y:10,w:14 }, { x:55,y:8,w:12 }, { x:80,y:6,w:10 }, { x:108,y:11,w:16 }, { x:135,y:9,w:14 }, { x:160,y:7,w:12 }, { x:185,y:5,w:10 }, { x:215,y:10,w:16 }, { x:245,y:8,w:14 }, { x:270,y:6,w:12 }, { x:300,y:11,w:10 }, { x:330,y:9,w:16 }, { x:360,y:7,w:14 }, { x:385,y:5,w:12 }, { x:415,y:10,w:10 }, { x:445,y:8,w:16 }, { x:475,y:6,w:14 }, { x:505,y:11,w:12 }, { x:535,y:9,w:10 }, { x:565,y:7,w:16 } ],
      pits: [ [98,108], [205,215], [290,300], [410,415], [495,505], [560,565] ],
      enemies: [ {type:'spiny',x:20}, {type:'flying',x:42,y:5}, {type:'bouncing',x:75}, {type:'goomba',x:125}, {type:'flying',x:155,y:3}, {type:'spiny',x:175}, {type:'bouncing',x:225}, {type:'goomba',x:280}, {type:'flying',x:320,y:6}, {type:'spiny',x:350}, {type:'bouncing',x:395}, {type:'goomba',x:440}, {type:'flying',x:485,y:4}, {type:'spiny',x:515}, {type:'bouncing',x:545}, {type:'goomba',x:585} ],
      coins: [ [15,11], [37,9], [60,7], [85,5], [113,10], [140,8], [165,6], [190,4], [220,9], [250,7], [275,5], [305,10], [335,8], [365,6], [390,4], [420,9], [450,7], [480,5], [510,10], [540,8], [570,6] ],
      powerUps: [ {x:85,y:5,type:'mushroom'}, {x:190,y:4,type:'mushroom'}, {x:390,y:4,type:'mushroom'}, {x:570,y:6,type:'mushroom'} ]
    },
    {
      width: 640,
      platforms: [ { x:8,y:14,w:16 }, { x:30,y:12,w:14 }, { x:52,y:10,w:12 }, { x:78,y:8,w:10 }, { x:105,y:6,w:16 }, { x:135,y:11,w:14 }, { x:160,y:9,w:12 }, { x:185,y:7,w:10 }, { x:215,y:5,w:16 }, { x:245,y:10,w:14 }, { x:275,y:8,w:12 }, { x:305,y:6,w:10 }, { x:335,y:11,w:16 }, { x:365,y:9,w:14 }, { x:390,y:7,w:12 }, { x:420,y:5,w:10 }, { x:450,y:10,w:16 }, { x:480,y:8,w:14 }, { x:510,y:6,w:12 }, { x:540,y:11,w:10 }, { x:570,y:9,w:16 } ],
      pits: [ [95,105], [205,215], [295,305], [415,420], [500,510], [565,570] ],
      enemies: [ {type:'flying',x:16,y:9}, {type:'spiny',x:38}, {type:'bouncing',x:70}, {type:'goomba',x:115}, {type:'flying',x:145,y:7}, {type:'spiny',x:170}, {type:'bouncing',x:195}, {type:'goomba',x:230}, {type:'flying',x:255,y:5}, {type:'spiny',x:285}, {type:'bouncing',x:315}, {type:'goomba',x:350}, {type:'flying',x:380,y:8}, {type:'spiny',x:405}, {type:'bouncing',x:435}, {type:'goomba',x:470}, {type:'flying',x:495,y:6}, {type:'spiny',x:525}, {type:'bouncing',x:555}, {type:'goomba',x:590} ],
      coins: [ [13,13], [35,11], [57,9], [83,7], [110,5], [140,10], [165,8], [190,6], [220,4], [250,9], [280,7], [310,5], [340,10], [370,8], [395,6], [425,4], [455,9], [485,7], [515,5], [545,10], [575,8] ],
      powerUps: [ {x:83,y:7,type:'mushroom'}, {x:220,y:4,type:'mushroom'}, {x:425,y:4,type:'mushroom'}, {x:575,y:8,type:'mushroom'} ]
    },
    {
      width: 660,
      platforms: [ { x:12,y:13,w:18 }, { x:35,y:11,w:16 }, { x:60,y:9,w:14 }, { x:85,y:7,w:12 }, { x:115,y:5,w:18 }, { x:145,y:10,w:16 }, { x:175,y:8,w:14 }, { x:205,y:6,w:12 }, { x:235,y:11,w:18 }, { x:265,y:9,w:16 }, { x:295,y:7,w:14 }, { x:325,y:5,w:12 }, { x:355,y:10,w:18 }, { x:385,y:8,w:16 }, { x:415,y:6,w:14 }, { x:445,y:11,w:12 }, { x:475,y:9,w:18 }, { x:505,y:7,w:16 }, { x:535,y:5,w:14 }, { x:565,y:10,w:12 }, { x:595,y:8,w:18 } ],
      pits: [ [105,115], [225,235], [315,325], [435,445], [525,535], [585,595] ],
      enemies: [ {type:'spiny',x:22}, {type:'flying',x:45,y:6}, {type:'bouncing',x:80}, {type:'goomba',x:130}, {type:'flying',x:165,y:4}, {type:'spiny',x:190}, {type:'bouncing',x:220}, {type:'goomba',x:275}, {type:'flying',x:310,y:7}, {type:'spiny',x:340}, {type:'bouncing',x:375}, {type:'goomba',x:425}, {type:'flying',x:460,y:5}, {type:'spiny',x:490}, {type:'bouncing',x:520}, {type:'goomba',x:570}, {type:'flying',x:610,y:8} ],
      coins: [ [17,12], [40,10], [65,8], [90,6], [120,4], [150,9], [180,7], [210,5], [240,10], [270,8], [300,6], [330,4], [360,9], [390,7], [420,5], [450,10], [480,8], [510,6], [540,4], [570,9], [600,7] ],
      powerUps: [ {x:90,y:6,type:'mushroom'}, {x:210,y:5,type:'mushroom'}, {x:420,y:5,type:'mushroom'}, {x:600,y:7,type:'mushroom'} ]
    },
    // 4-1: 幽灵城堡
    {
      width: 680,
      platforms: [ { x:10,y:15,w:20 }, { x:35,y:13,w:18 }, { x:65,y:11,w:16 }, { x:95,y:9,w:14 }, { x:125,y:7,w:20 }, { x:160,y:12,w:18 }, { x:190,y:10,w:16 }, { x:220,y:8,w:14 }, { x:250,y:6,w:20 }, { x:285,y:11,w:18 }, { x:315,y:9,w:16 }, { x:345,y:7,w:14 }, { x:375,y:5,w:20 }, { x:410,y:10,w:18 }, { x:440,y:8,w:16 }, { x:470,y:6,w:14 }, { x:500,y:12,w:20 }, { x:535,y:10,w:18 }, { x:565,y:8,w:16 }, { x:595,y:6,w:14 }, { x:625,y:11,w:20 } ],
      pits: [ [115,125], [240,250], [365,375], [490,500], [615,625] ],
      enemies: [ {type:'flying',x:25,y:8}, {type:'spiny',x:50}, {type:'goomba',x:140}, {type:'spiny',x:205}, {type:'goomba',x:300}, {type:'flying',x:330,y:4}, {type:'goomba',x:425}, {type:'tough',x:100}, {type:'tough',x:250}, {type:'tough',x:380}, {type:'tough',x:500}, {type:'tough',x:600}, {type:'bouncing',x:75}, {type:'flying',x:120,y:6}, {type:'spiny',x:170}, {type:'goomba',x:230}, {type:'bouncing',x:280}, {type:'flying',x:350,y:5}, {type:'spiny',x:400}, {type:'goomba',x:450}, {type:'tough',x:320}, {type:'flying',x:480,y:7}, {type:'bouncing',x:530}, {type:'spiny',x:570}, {type:'tough',x:640}, {type:'flying',x:660,y:3} ],
      coins: [ [20,14], [45,12], [75,10], [105,8], [135,6], [170,11], [200,9], [230,7], [260,5], [295,10], [325,8], [355,6], [385,4], [420,9], [450,7], [480,5], [510,11], [545,9], [575,7], [605,5], [635,10], [25,13], [55,11], [85,9], [115,7], [145,5], [180,10], [210,8], [240,6], [270,4], [305,9], [335,7], [365,5], [395,3], [430,8], [460,6], [490,4], [520,10], [555,8], [585,6], [615,4], [645,9], [35,12], [65,10], [95,8], [125,6], [155,11], [185,9], [215,7], [245,5], [275,10], [305,8], [345,6], [375,4], [405,9], [435,7], [465,5], [495,11], [525,9], [555,7], [585,5], [615,10] ],
      powerUps: [ {x:105,y:8,type:'mushroom'}, {x:260,y:5,type:'mushroom'}, {x:385,y:4,type:'mushroom'}, {x:605,y:5,type:'mushroom'}, {x:170,y:10,type:'mushroom'}, {x:325,y:6,type:'star'}, {x:450,y:6,type:'gem'}, {x:575,y:6,type:'mushroom'}, {x:375,y:4,type:'star'}, {x:520,y:9,type:'gem'} ]
    },
    // 4-2: 时空隧道
    {
      width: 700,
      platforms: [ { x:8,y:14,w:22 }, { x:38,y:12,w:20 }, { x:68,y:10,w:18 }, { x:98,y:8,w:16 }, { x:128,y:6,w:22 }, { x:165,y:11,w:20 }, { x:195,y:9,w:18 }, { x:225,y:7,w:16 }, { x:255,y:5,w:22 }, { x:290,y:10,w:20 }, { x:320,y:8,w:18 }, { x:350,y:6,w:16 }, { x:380,y:4,w:22 }, { x:415,y:9,w:20 }, { x:445,y:7,w:18 }, { x:475,y:5,w:16 }, { x:505,y:11,w:22 }, { x:540,y:9,w:20 }, { x:570,y:7,w:18 }, { x:600,y:5,w:16 }, { x:630,y:10,w:22 } ],
      pits: [ [118,128], [245,255], [370,380], [495,505], [620,630] ],
      enemies: [ {type:'spiny',x:20}, {type:'flying',x:50,y:7}, {type:'bouncing',x:85}, {type:'goomba',x:145}, {type:'flying',x:180,y:5}, {type:'spiny',x:210}, {type:'bouncing',x:240}, {type:'goomba',x:305}, {type:'flying',x:335,y:3}, {type:'spiny',x:365}, {type:'bouncing',x:395}, {type:'goomba',x:430}, {type:'flying',x:460,y:6}, {type:'spiny',x:490}, {type:'bouncing',x:520}, {type:'goomba',x:555}, {type:'flying',x:585,y:4}, {type:'spiny',x:615}, {type:'bouncing',x:645} ],
      coins: [ [18,13], [48,11], [78,9], [108,7], [138,5], [175,10], [205,8], [235,6], [265,4], [300,9], [330,7], [360,5], [390,3], [425,8], [455,6], [485,4], [515,10], [550,8], [580,6], [610,4], [640,9] ],
      powerUps: [ {x:108,y:7,type:'mushroom'}, {x:265,y:4,type:'mushroom'}, {x:390,y:3,type:'mushroom'}, {x:610,y:4,type:'mushroom'} ]
    },
    // 4-3: 机械工厂
    {
      width: 720,
      platforms: [ { x:12,y:13,w:24 }, { x:42,y:11,w:22 }, { x:72,y:9,w:20 }, { x:102,y:7,w:18 }, { x:132,y:5,w:24 }, { x:170,y:10,w:22 }, { x:200,y:8,w:20 }, { x:230,y:6,w:18 }, { x:260,y:12,w:24 }, { x:295,y:10,w:22 }, { x:325,y:8,w:20 }, { x:355,y:6,w:18 }, { x:385,y:4,w:24 }, { x:420,y:9,w:22 }, { x:450,y:7,w:20 }, { x:480,y:5,w:18 }, { x:510,y:11,w:24 }, { x:545,y:9,w:22 }, { x:575,y:7,w:20 }, { x:605,y:5,w:18 }, { x:635,y:10,w:24 } ],
      pits: [ [122,132], [250,260], [375,385], [500,510], [625,635] ],
      enemies: [ {type:'flying',x:24,y:8}, {type:'spiny',x:54}, {type:'bouncing',x:89}, {type:'goomba',x:150}, {type:'flying',x:185,y:6}, {type:'spiny',x:215}, {type:'bouncing',x:245}, {type:'goomba',x:310}, {type:'flying',x:340,y:4}, {type:'spiny',x:370}, {type:'bouncing',x:400}, {type:'goomba',x:435}, {type:'flying',x:465,y:7}, {type:'spiny',x:495}, {type:'bouncing',x:525}, {type:'goomba',x:560}, {type:'flying',x:590,y:5}, {type:'spiny',x:620}, {type:'bouncing',x:650} ],
      coins: [ [22,12], [52,10], [82,8], [112,6], [142,4], [180,9], [210,7], [240,5], [270,11], [305,9], [335,7], [365,5], [395,3], [430,8], [460,6], [490,4], [520,10], [555,8], [585,6], [615,4], [645,9] ],
      powerUps: [ {x:112,y:6,type:'mushroom'}, {x:270,y:11,type:'mushroom'}, {x:395,y:3,type:'mushroom'}, {x:615,y:4,type:'mushroom'} ]
    },
    // 4-4: 水晶洞穴
    {
      width: 740,
      platforms: [ { x:10,y:12,w:20 }, { x:40,y:10,w:18 }, { x:70,y:8,w:16 }, { x:100,y:6,w:14 }, { x:130,y:13,w:20 }, { x:165,y:11,w:18 }, { x:195,y:9,w:16 }, { x:225,y:7,w:14 }, { x:255,y:5,w:20 }, { x:290,y:10,w:18 }, { x:320,y:8,w:16 }, { x:350,y:6,w:14 }, { x:380,y:4,w:20 }, { x:415,y:9,w:18 }, { x:445,y:7,w:16 }, { x:475,y:5,w:14 }, { x:505,y:11,w:20 }, { x:540,y:9,w:18 }, { x:570,y:7,w:16 }, { x:600,y:5,w:14 }, { x:630,y:10,w:20 } ],
      pits: [ [120,130], [245,255], [370,380], [495,505], [620,630] ],
      enemies: [ {type:'spiny',x:23}, {type:'flying',x:53,y:5}, {type:'bouncing',x:88}, {type:'goomba',x:145}, {type:'flying',x:180,y:7}, {type:'spiny',x:210}, {type:'bouncing',x:240}, {type:'goomba',x:305}, {type:'flying',x:335,y:4}, {type:'spiny',x:365}, {type:'bouncing',x:395}, {type:'goomba',x:430}, {type:'flying',x:460,y:6}, {type:'spiny',x:490}, {type:'bouncing',x:520}, {type:'goomba',x:555}, {type:'flying',x:585,y:3}, {type:'spiny',x:615}, {type:'bouncing',x:645} ],
      coins: [ [20,11], [50,9], [80,7], [107,5], [140,12], [175,10], [205,8], [235,6], [265,4], [300,9], [330,7], [360,5], [390,3], [425,8], [455,6], [485,4], [515,10], [550,8], [580,6], [607,4], [640,9] ],
      powerUps: [ {x:107,y:5,type:'mushroom'}, {x:265,y:4,type:'mushroom'}, {x:390,y:3,type:'mushroom'}, {x:607,y:4,type:'mushroom'} ]
    },
    // 4-5: 雷电风暴
    {
      width: 760,
      platforms: [ { x:8,y:15,w:28 }, { x:42,y:13,w:26 }, { x:76,y:11,w:24 }, { x:110,y:9,w:22 }, { x:144,y:7,w:28 }, { x:182,y:12,w:26 }, { x:216,y:10,w:24 }, { x:250,y:8,w:22 }, { x:284,y:6,w:28 }, { x:322,y:11,w:26 }, { x:356,y:9,w:24 }, { x:390,y:7,w:22 }, { x:424,y:5,w:28 }, { x:462,y:10,w:26 }, { x:496,y:8,w:24 }, { x:530,y:6,w:22 }, { x:564,y:12,w:28 }, { x:602,y:10,w:26 }, { x:636,y:8,w:24 }, { x:670,y:6,w:22 } ],
      pits: [ [134,144], [274,284], [414,424], [554,564], [690,700] ],
      enemies: [ {type:'flying',x:22,y:10}, {type:'spiny',x:56}, {type:'bouncing',x:95}, {type:'goomba',x:160}, {type:'flying',x:198,y:7}, {type:'spiny',x:232}, {type:'bouncing',x:266}, {type:'goomba',x:340}, {type:'flying',x:374,y:5}, {type:'spiny',x:408}, {type:'bouncing',x:442}, {type:'goomba',x:480}, {type:'flying',x:514,y:8}, {type:'spiny',x:548}, {type:'bouncing',x:582}, {type:'goomba',x:620}, {type:'flying',x:654,y:6}, {type:'spiny',x:688} ],
      coins: [ [18,14], [52,12], [86,10], [120,8], [154,6], [192,11], [226,9], [260,7], [294,5], [332,10], [366,8], [400,6], [434,4], [472,9], [506,7], [540,5], [574,11], [612,9], [646,7], [680,5] ],
      powerUps: [ {x:120,y:8,type:'mushroom'}, {x:294,y:5,type:'mushroom'}, {x:434,y:4,type:'mushroom'}, {x:680,y:5,type:'mushroom'} ]
    },
    // 4-6: 虚空之桥
    {
      width: 780,
      platforms: [ { x:10,y:14,w:30 }, { x:45,y:12,w:28 }, { x:80,y:10,w:26 }, { x:115,y:8,w:24 }, { x:150,y:6,w:30 }, { x:190,y:11,w:28 }, { x:225,y:9,w:26 }, { x:260,y:7,w:24 }, { x:295,y:13,w:30 }, { x:335,y:11,w:28 }, { x:370,y:9,w:26 }, { x:405,y:7,w:24 }, { x:440,y:5,w:30 }, { x:480,y:10,w:28 }, { x:515,y:8,w:26 }, { x:550,y:6,w:24 }, { x:585,y:12,w:30 }, { x:625,y:10,w:28 }, { x:660,y:8,w:26 }, { x:695,y:6,w:24 } ],
      pits: [ [140,150], [285,295], [430,440], [575,585], [720,730] ],
      enemies: [ {type:'spiny',x:25}, {type:'flying',x:60,y:7}, {type:'bouncing',x:100}, {type:'goomba',x:170}, {type:'flying',x:205,y:6}, {type:'spiny',x:240}, {type:'bouncing',x:275}, {type:'goomba',x:350}, {type:'flying',x:385,y:4}, {type:'spiny',x:420}, {type:'bouncing',x:455}, {type:'goomba',x:495}, {type:'flying',x:530,y:5}, {type:'spiny',x:565}, {type:'bouncing',x:600}, {type:'goomba',x:640}, {type:'flying',x:675,y:3}, {type:'spiny',x:710} ],
      coins: [ [20,13], [55,11], [90,9], [125,7], [160,5], [200,10], [235,8], [270,6], [305,12], [345,10], [380,8], [415,6], [450,4], [490,9], [525,7], [560,5], [595,11], [635,9], [670,7], [705,5] ],
      powerUps: [ {x:125,y:7,type:'mushroom'}, {x:305,y:12,type:'mushroom'}, {x:450,y:4,type:'mushroom'}, {x:705,y:5,type:'mushroom'} ]
    },
    // 4-7: 混沌战场
    {
      width: 800,
      platforms: [ { x:12,y:13,w:32 }, { x:48,y:11,w:30 }, { x:84,y:9,w:28 }, { x:120,y:7,w:26 }, { x:156,y:15,w:32 }, { x:198,y:13,w:30 }, { x:234,y:11,w:28 }, { x:270,y:9,w:26 }, { x:306,y:7,w:32 }, { x:348,y:12,w:30 }, { x:384,y:10,w:28 }, { x:420,y:8,w:26 }, { x:456,y:6,w:32 }, { x:498,y:11,w:30 }, { x:534,y:9,w:28 }, { x:570,y:7,w:26 }, { x:606,y:13,w:32 }, { x:648,y:11,w:30 }, { x:684,y:9,w:28 }, { x:720,y:7,w:26 } ],
      pits: [ [146,156], [296,306], [446,456], [596,606], [750,760] ],
      enemies: [ {type:'flying',x:26,y:8}, {type:'spiny',x:62}, {type:'bouncing',x:105}, {type:'goomba',x:175}, {type:'flying',x:213,y:9}, {type:'spiny',x:249}, {type:'bouncing',x:285}, {type:'goomba',x:365}, {type:'flying',x:399,y:6}, {type:'spiny',x:435}, {type:'bouncing',x:471}, {type:'goomba',x:515}, {type:'flying',x:549,y:4}, {type:'spiny',x:585}, {type:'bouncing',x:621}, {type:'goomba',x:665}, {type:'flying',x:699,y:7}, {type:'spiny',x:735} ],
      coins: [ [22,12], [58,10], [94,8], [130,6], [166,14], [208,12], [244,10], [280,8], [316,6], [358,11], [394,9], [430,7], [466,5], [508,10], [544,8], [580,6], [616,12], [658,10], [694,8], [730,6] ],
      powerUps: [ {x:130,y:6,type:'mushroom'}, {x:316,y:6,type:'mushroom'}, {x:466,y:5,type:'mushroom'}, {x:730,y:6,type:'mushroom'} ]
    },
    // 4-8: 终极审判
    {
      width: 820,
      platforms: [ { x:10,y:14,w:28 }, { x:45,y:12,w:26 }, { x:80,y:10,w:24 }, { x:115,y:8,w:22 }, { x:150,y:6,w:28 }, { x:190,y:11,w:26 }, { x:225,y:9,w:24 }, { x:260,y:7,w:22 }, { x:295,y:5,w:28 }, { x:335,y:10,w:26 }, { x:370,y:8,w:24 }, { x:405,y:6,w:22 }, { x:440,y:4,w:28 }, { x:480,y:9,w:26 }, { x:515,y:7,w:24 }, { x:550,y:5,w:22 }, { x:585,y:12,w:28 }, { x:625,y:10,w:26 }, { x:660,y:8,w:24 }, { x:695,y:6,w:22 } ],
      pits: [ [140,150], [285,295], [430,440], [575,585], [685,695] ],
      enemies: [ {type:'spiny',x:25}, {type:'flying',x:60,y:7}, {type:'bouncing',x:95}, {type:'goomba',x:165}, {type:'flying',x:205,y:6}, {type:'spiny',x:240}, {type:'bouncing',x:275}, {type:'goomba',x:350}, {type:'flying',x:385,y:4}, {type:'spiny',x:420}, {type:'bouncing',x:455}, {type:'goomba',x:495}, {type:'flying',x:530,y:5}, {type:'spiny',x:565}, {type:'bouncing',x:600}, {type:'goomba',x:640}, {type:'flying',x:675,y:6}, {type:'spiny',x:710} ],
      coins: [ [20,13], [55,11], [90,9], [125,7], [160,5], [200,10], [235,8], [270,6], [305,4], [345,9], [380,7], [415,5], [450,3], [490,8], [525,6], [560,4], [595,11], [635,9], [670,7], [705,5] ],
      powerUps: [ {x:125,y:7,type:'mushroom'}, {x:305,y:4,type:'mushroom'}, {x:450,y:3,type:'mushroom'}, {x:705,y:5,type:'mushroom'} ]
    },
    // 5-1: 天界之门
    {
      width: 840,
      platforms: [ { x:8,y:15,w:36 }, { x:52,y:13,w:34 }, { x:96,y:11,w:32 }, { x:140,y:9,w:30 }, { x:184,y:7,w:36 }, { x:232,y:12,w:34 }, { x:276,y:10,w:32 }, { x:320,y:8,w:30 }, { x:364,y:14,w:36 }, { x:412,y:12,w:34 }, { x:456,y:10,w:32 }, { x:500,y:8,w:30 }, { x:544,y:6,w:36 }, { x:592,y:11,w:34 }, { x:636,y:9,w:32 }, { x:680,y:7,w:30 }, { x:724,y:13,w:36 }, { x:772,y:11,w:34 }, { x:816,y:9,w:30 } ],
      pits: [ [174,184], [354,364], [534,544], [714,724], [806,816] ],
      enemies: [ {type:'flying',x:26,y:10}, {type:'spiny',x:70}, {type:'bouncing',x:118}, {type:'goomba',x:205}, {type:'flying',x:249,y:7}, {type:'spiny',x:293}, {type:'bouncing',x:337}, {type:'goomba',x:430}, {type:'flying',x:474,y:5}, {type:'spiny',x:518}, {type:'bouncing',x:562}, {type:'goomba',x:610}, {type:'flying',x:654,y:6}, {type:'spiny',x:698}, {type:'bouncing',x:742}, {type:'goomba',x:790}, {type:'flying',x:834,y:4} ],
      coins: [ [18,14], [62,12], [106,10], [150,8], [194,6], [242,11], [286,9], [330,7], [374,13], [422,11], [466,9], [510,7], [554,5], [602,10], [646,8], [690,6], [734,12], [782,10], [826,8] ],
      powerUps: [ {x:150,y:8,type:'mushroom'}, {x:374,y:13,type:'mushroom'}, {x:554,y:5,type:'mushroom'}, {x:826,y:8,type:'mushroom'} ]
    },
    // 5-2: 星河战舰
    {
      width: 860,
      platforms: [ { x:10,y:14,w:38 }, { x:54,y:12,w:36 }, { x:98,y:10,w:34 }, { x:142,y:8,w:32 }, { x:186,y:16,w:38 }, { x:238,y:14,w:36 }, { x:282,y:12,w:34 }, { x:326,y:10,w:32 }, { x:370,y:8,w:38 }, { x:422,y:13,w:36 }, { x:466,y:11,w:34 }, { x:510,y:9,w:32 }, { x:554,y:7,w:38 }, { x:606,y:12,w:36 }, { x:650,y:10,w:34 }, { x:694,y:8,w:32 }, { x:738,y:14,w:38 }, { x:790,y:12,w:36 }, { x:834,y:10,w:34 } ],
      pits: [ [176,186], [360,370], [544,554], [728,738], [828,838] ],
      enemies: [ {type:'spiny',x:29}, {type:'flying',x:73,y:7}, {type:'bouncing',x:121}, {type:'goomba',x:215}, {type:'flying',x:259,y:9}, {type:'spiny',x:303}, {type:'bouncing',x:347}, {type:'goomba',x:441}, {type:'flying',x:485,y:6}, {type:'spiny',x:529}, {type:'bouncing',x:573}, {type:'goomba',x:625}, {type:'flying',x:669,y:5}, {type:'spiny',x:713}, {type:'bouncing',x:757}, {type:'goomba',x:809}, {type:'flying',x:853,y:7} ],
      coins: [ [20,13], [64,11], [108,9], [152,7], [196,15], [248,13], [292,11], [336,9], [380,7], [432,12], [476,10], [520,8], [564,6], [616,11], [660,9], [704,7], [748,13], [800,11], [844,9] ],
      powerUps: [ {x:152,y:7,type:'mushroom'}, {x:380,y:7,type:'mushroom'}, {x:564,y:6,type:'mushroom'}, {x:844,y:9,type:'mushroom'} ]
    },
    // 5-3: 时空裂缝
    {
      width: 880,
      platforms: [ { x:12,y:12,w:30 }, { x:50,y:10,w:28 }, { x:88,y:8,w:26 }, { x:125,y:6,w:24 }, { x:162,y:14,w:30 }, { x:205,y:12,w:28 }, { x:243,y:10,w:26 }, { x:280,y:8,w:24 }, { x:317,y:6,w:30 }, { x:360,y:11,w:28 }, { x:398,y:9,w:26 }, { x:435,y:7,w:24 }, { x:472,y:5,w:30 }, { x:515,y:10,w:28 }, { x:553,y:8,w:26 }, { x:590,y:6,w:24 }, { x:627,y:12,w:30 }, { x:670,y:10,w:28 }, { x:708,y:8,w:26 }, { x:745,y:6,w:24 } ],
      pits: [ [149,162], [304,317], [459,472], [614,627], [732,745] ],
      enemies: [ {type:'flying',x:30,y:7}, {type:'spiny',x:65}, {type:'bouncing',x:105}, {type:'goomba',x:180}, {type:'flying',x:220,y:7}, {type:'spiny',x:260}, {type:'bouncing',x:295}, {type:'goomba',x:340}, {type:'flying',x:375,y:6}, {type:'spiny',x:415}, {type:'bouncing',x:450}, {type:'goomba',x:490}, {type:'flying',x:530,y:5}, {type:'spiny',x:570}, {type:'bouncing',x:605}, {type:'goomba',x:645}, {type:'flying',x:685,y:6}, {type:'spiny',x:725}, {type:'bouncing',x:760} ],
      coins: [ [22,11], [60,9], [98,7], [135,5], [172,13], [215,11], [253,9], [290,7], [327,5], [370,10], [408,8], [445,6], [482,4], [525,9], [563,7], [600,5], [637,11], [680,9], [718,7], [755,5] ],
      powerUps: [ {x:135,y:5,type:'mushroom'}, {x:327,y:5,type:'mushroom'}, {x:482,y:4,type:'mushroom'}, {x:755,y:5,type:'mushroom'} ]
    },
    // 5-4: 无尽深渊
    {
      width: 900,
      platforms: [ { x:10,y:12,w:42 }, { x:60,y:10,w:40 }, { x:110,y:8,w:38 }, { x:160,y:6,w:36 }, { x:210,y:14,w:42 }, { x:264,y:12,w:40 }, { x:314,y:10,w:38 }, { x:364,y:8,w:36 }, { x:414,y:16,w:42 }, { x:468,y:14,w:40 }, { x:518,y:12,w:38 }, { x:568,y:10,w:36 }, { x:618,y:8,w:42 }, { x:672,y:13,w:40 }, { x:722,y:11,w:38 }, { x:772,y:9,w:36 }, { x:822,y:7,w:42 }, { x:876,y:12,w:40 } ],
      pits: [ [200,210], [404,414], [608,618], [812,822], [866,876] ],
      enemies: [ {type:'spiny',x:31}, {type:'flying',x:81,y:5}, {type:'bouncing',x:135}, {type:'goomba',x:237}, {type:'flying',x:287,y:7}, {type:'spiny',x:337}, {type:'bouncing',x:387}, {type:'goomba',x:491}, {type:'flying',x:541,y:9}, {type:'spiny',x:591}, {type:'bouncing',x:641}, {type:'goomba',x:695}, {type:'flying',x:745,y:6}, {type:'spiny',x:795}, {type:'bouncing',x:845}, {type:'goomba',x:899} ],
      coins: [ [20,11], [70,9], [120,7], [170,5], [220,13], [274,11], [324,9], [374,7], [424,15], [478,13], [528,11], [578,9], [628,7], [682,12], [732,10], [782,8], [832,6], [886,11] ],
      powerUps: [ {x:170,y:5,type:'mushroom'}, {x:424,y:15,type:'mushroom'}, {x:628,y:7,type:'mushroom'}, {x:886,y:11,type:'mushroom'} ]
    },
    // 5-5: 神圣试炼
    {
      width: 920,
      platforms: [ { x:8,y:10,w:32 }, { x:50,y:8,w:30 }, { x:90,y:6,w:28 }, { x:130,y:4,w:26 }, { x:170,y:12,w:32 }, { x:215,y:10,w:30 }, { x:255,y:8,w:28 }, { x:295,y:6,w:26 }, { x:335,y:14,w:32 }, { x:380,y:12,w:30 }, { x:420,y:10,w:28 }, { x:460,y:8,w:26 }, { x:500,y:6,w:32 }, { x:545,y:11,w:30 }, { x:585,y:9,w:28 }, { x:625,y:7,w:26 }, { x:665,y:5,w:32 } ],
      pits: [ [160,170], [325,335], [490,500], [655,665] ],
      enemies: [ {type:'flying',x:25,y:5}, {type:'spiny',x:65}, {type:'bouncing',x:105}, {type:'goomba',x:190}, {type:'flying',x:230,y:5}, {type:'spiny',x:270}, {type:'bouncing',x:310}, {type:'goomba',x:355}, {type:'flying',x:395,y:7}, {type:'spiny',x:435}, {type:'bouncing',x:475}, {type:'goomba',x:520}, {type:'flying',x:560,y:6}, {type:'spiny',x:600}, {type:'bouncing',x:640}, {type:'goomba',x:680} ],
      coins: [ [18,9], [60,7], [100,5], [140,3], [180,11], [225,9], [265,7], [305,5], [345,13], [390,11], [430,9], [470,7], [510,5], [555,10], [595,8], [635,6], [675,4] ],
      powerUps: [ {x:140,y:3,type:'mushroom'}, {x:345,y:13,type:'mushroom'}, {x:510,y:5,type:'mushroom'}, {x:675,y:4,type:'mushroom'} ]
    },
    // 5-6: 创世纪元
    {
      width: 940,
      platforms: [ { x:10,y:9,w:34 }, { x:55,y:7,w:32 }, { x:100,y:5,w:30 }, { x:145,y:3,w:28 }, { x:190,y:11,w:34 }, { x:240,y:9,w:32 }, { x:285,y:7,w:30 }, { x:330,y:5,w:28 }, { x:375,y:13,w:34 }, { x:425,y:11,w:32 }, { x:470,y:9,w:30 }, { x:515,y:7,w:28 }, { x:560,y:5,w:34 }, { x:610,y:10,w:32 }, { x:655,y:8,w:30 }, { x:700,y:6,w:28 }, { x:745,y:4,w:34 } ],
      pits: [ [180,190], [365,375], [550,560], [735,745] ],
      enemies: [ {type:'spiny',x:30}, {type:'flying',x:75,y:3}, {type:'bouncing',x:120}, {type:'goomba',x:215}, {type:'flying',x:260,y:4}, {type:'spiny',x:305}, {type:'bouncing',x:350}, {type:'goomba',x:400}, {type:'flying',x:445,y:6}, {type:'spiny',x:490}, {type:'bouncing',x:535}, {type:'goomba',x:585}, {type:'flying',x:630,y:5}, {type:'spiny',x:675}, {type:'bouncing',x:720}, {type:'goomba',x:765} ],
      coins: [ [20,8], [65,6], [110,4], [155,2], [200,10], [250,8], [295,6], [340,4], [385,12], [435,10], [480,8], [525,6], [570,4], [620,9], [665,7], [710,5], [755,3] ],
      powerUps: [ {x:155,y:2,type:'mushroom'}, {x:385,y:12,type:'mushroom'}, {x:570,y:4,type:'mushroom'}, {x:755,y:3,type:'mushroom'} ]
    },
    // 5-7: 永恒轮回
    {
      width: 960,
      platforms: [ { x:12,y:8,w:36 }, { x:60,y:6,w:34 }, { x:108,y:4,w:32 }, { x:156,y:2,w:30 }, { x:204,y:10,w:36 }, { x:255,y:8,w:34 }, { x:303,y:6,w:32 }, { x:351,y:4,w:30 }, { x:399,y:12,w:36 }, { x:450,y:10,w:34 }, { x:498,y:8,w:32 }, { x:546,y:6,w:30 }, { x:594,y:14,w:36 }, { x:645,y:12,w:34 }, { x:693,y:10,w:32 }, { x:741,y:8,w:30 }, { x:789,y:6,w:36 } ],
      pits: [ [195,204], [390,399], [585,594], [780,789] ],
      enemies: [ {type:'flying',x:30,y:3}, {type:'spiny',x:75}, {type:'bouncing',x:125}, {type:'goomba',x:225}, {type:'flying',x:270,y:3}, {type:'spiny',x:320}, {type:'bouncing',x:370}, {type:'goomba',x:420}, {type:'flying',x:465,y:5}, {type:'spiny',x:515}, {type:'bouncing',x:565}, {type:'goomba',x:615}, {type:'flying',x:660,y:7}, {type:'spiny',x:710}, {type:'bouncing',x:760}, {type:'goomba',x:810} ],
      coins: [ [22,7], [70,5], [118,3], [166,1], [214,9], [265,7], [313,5], [361,3], [409,11], [460,9], [508,7], [556,5], [604,13], [655,11], [703,9], [751,7], [799,5] ],
      powerUps: [ {x:166,y:1,type:'mushroom'}, {x:409,y:11,type:'mushroom'}, {x:604,y:13,type:'mushroom'}, {x:799,y:5,type:'mushroom'} ]
    },
    // 5-8: 终极超越
    {
      width: 980,
      platforms: [ { x:10,y:7,w:38 }, { x:60,y:5,w:36 }, { x:110,y:3,w:34 }, { x:160,y:1,w:32 }, { x:210,y:9,w:38 }, { x:265,y:7,w:36 }, { x:315,y:5,w:34 }, { x:365,y:3,w:32 }, { x:415,y:11,w:38 }, { x:470,y:9,w:36 }, { x:520,y:7,w:34 }, { x:570,y:5,w:32 }, { x:620,y:13,w:38 }, { x:675,y:11,w:36 }, { x:725,y:9,w:34 }, { x:775,y:7,w:32 }, { x:825,y:5,w:38 } ],
      pits: [ [200,210], [405,415], [610,620], [815,825] ],
      enemies: [ {type:'spiny',x:30}, {type:'flying',x:80,y:1}, {type:'bouncing',x:130}, {type:'goomba',x:235}, {type:'flying',x:285,y:2}, {type:'spiny',x:335}, {type:'bouncing',x:385}, {type:'goomba',x:445}, {type:'flying',x:495,y:4}, {type:'spiny',x:545}, {type:'bouncing',x:595}, {type:'goomba',x:650}, {type:'flying',x:700,y:6}, {type:'spiny',x:750}, {type:'bouncing',x:800}, {type:'goomba',x:850} ],
      coins: [ [20,6], [70,4], [120,2], [170,0], [220,8], [275,6], [325,4], [375,2], [425,10], [480,8], [530,6], [580,4], [630,12], [685,10], [735,8], [785,6], [835,4] ],
      powerUps: [ {x:170,y:0,type:'mushroom'}, {x:425,y:10,type:'mushroom'}, {x:630,y:12,type:'mushroom'}, {x:835,y:4,type:'mushroom'} ]
    }
  ];
  let currentLevel = 0;
  function buildLevel(idx) {
    const def = levelDefs[idx] || levelDefs[0];
    world.width = def.width; world.height = 18; world.tiles = new Array(world.width * world.height).fill(0);
    for (let x = 0; x < world.width; x++) { setTile(x, world.height - 2, 1); setTile(x, world.height - 1, 1); }
    def.platforms.forEach(p => { for (let i = 0; i < p.w; i++) setTile(p.x + i, p.y, 1); });
    // Clear both ground rows for pits so the player truly falls
    def.pits.forEach(([a,b]) => {
      for (let x = a; x < b; x++) {
        setTile(x, world.height - 2, 0);
        setTile(x, world.height - 1, 0);
      }
    });
    setTile(world.width - 6, world.height - 3, 2);
    // Coins and power-ups
    coinTiles.clear();
    (def.coins || []).forEach(([cx, cy]) => {
      // 只在空气位置放置金币，避免金币卡在固体方块内
      if (getTile(cx, cy) === 0) {
        coinTiles.add(cy * world.width + cx);
      }
    });
    powerUps.length = 0;
    (def.powerUps || []).forEach(p => powerUps.push({ x: p.x * TILE + 16, y: p.y * TILE + 16, r: 7, type: p.type }));
    
    
    // 清空新增元素
    particles.length = 0;
    floatingPlatforms.length = 0;
    collectibles.length = 0;
    
    // 添加浮动平台（根据关卡）
    if (idx >= 2 && idx < 8) {
      createFloatingPlatform(15, 8, 3, 1, 0, 1, 0.5);
      createFloatingPlatform(25, 6, 2, 1, 1, 0, 0.3);
    }
    if (idx >= 4 && idx < 8) {
      createFloatingPlatform(35, 7, 2, 1, 0, 1, 0.7);
      createFloatingPlatform(45, 5, 3, 1, 1, 0, 0.4);
    }
    
    // 2-x关卡的浮动平台
    if (idx >= 8 && idx < 16) {
      const levelOffset = (idx - 8) * 60;
      createFloatingPlatform(20 + levelOffset, 7, 4, 1, 1, 0, 0.4);
      createFloatingPlatform(40 + levelOffset, 5, 3, 1, 0, 1, 0.6);
      createFloatingPlatform(80 + levelOffset, 9, 5, 1, 1, 1, 0.3);
    }
    
    // 3-x关卡的复杂浮动平台
    if (idx >= 16 && idx < 24) {
      const levelOffset = (idx - 16) * 80;
      createFloatingPlatform(25 + levelOffset, 6, 4, 1, 1, 1, 0.5);
      createFloatingPlatform(50 + levelOffset, 8, 3, 1, 0, 1, 0.7);
      createFloatingPlatform(75 + levelOffset, 4, 5, 1, 1, 0, 0.4);
      createFloatingPlatform(100 + levelOffset, 10, 2, 1, 1, 1, 0.8);
    }
    
    // 4-x关卡的高级浮动平台系统
    if (idx >= 24 && idx < 32) {
      const level = idx - 24;
      const baseOffset = level * 100;
      // 主要平台群
      createFloatingPlatform(30 + baseOffset, 5, 6, 1, 1, 1, 0.6);
      createFloatingPlatform(60 + baseOffset, 7, 4, 1, 0, 1, 0.8);
      createFloatingPlatform(90 + baseOffset, 3, 8, 1, 1, 0, 0.5);
      // 复杂移动平台
      createFloatingPlatform(120 + baseOffset, 9, 3, 1, 1, 1, 1.0);
      createFloatingPlatform(150 + baseOffset, 6, 5, 1, 0, 1, 0.7);
      // 挑战性平台
      createFloatingPlatform(180 + baseOffset, 2, 4, 1, 1, 1, 1.2);
    }
    
    // 5-x关卡的终极浮动平台网络
    if (idx >= 32) {
      const level = idx - 32;
      const baseOffset = level * 120;
      // 多层平台网络
      createFloatingPlatform(25 + baseOffset, 4, 8, 1, 1, 1, 0.8);
      createFloatingPlatform(50 + baseOffset, 8, 6, 1, 0, 1, 1.0);
      createFloatingPlatform(75 + baseOffset, 2, 10, 1, 1, 0, 0.6);
      createFloatingPlatform(105 + baseOffset, 6, 4, 1, 1, 1, 1.2);
      createFloatingPlatform(135 + baseOffset, 10, 7, 1, 0, 1, 0.9);
      // 终极挑战平台
      createFloatingPlatform(165 + baseOffset, 3, 5, 1, 1, 1, 1.5);
      createFloatingPlatform(195 + baseOffset, 7, 3, 1, 1, 0, 1.3);
    }
    

  }
  function spawnLevelEnemies(idx) {
    enemies.splice(0, enemies.length);
    const def = levelDefs[idx] || levelDefs[0];
    def.enemies.forEach((e, i) => {
      const dir = i % 2 === 0 ? -1 : 1;
      if (typeof e === 'number') return spawnGoomba(e, world.height - 2, dir); // backward compat
      if (e.type === 'spiny') spawnSpiny(e.x, world.height - 2, dir);
      else if (e.type === 'flying') spawnFlyingEnemy(e.x, e.y || 8);
      else if (e.type === 'bouncing') spawnBouncingEnemy(e.x, world.height - 2);
      else if (e.type === 'tough') spawnToughEnemy(e.x, world.height - 2);
      else spawnGoomba(e.x, world.height - 2, dir);
    });
    
    // 基础额外敌人（简化版本）
    if (idx >= 2) {
      spawnFlyingEnemy(18, 6);
    }
    if (idx >= 4) {
      spawnBouncingEnemy(28, world.height - 2);
    }
    if (idx >= 6) {
      spawnSpiny(38, world.height - 2, 1);
    }
    
    // 确保每个关卡都有至少一个tough敌人（作为backup）
    const hasToughEnemy = def.enemies.some(e => e.type === 'tough');
    if (!hasToughEnemy) {
      console.log(`关卡 ${idx} 没有tough敌人，自动添加一个`);
      // 在关卡中间位置生成一个tough敌人
      const midX = Math.floor(def.width / 2);
      spawnToughEnemy(midX, world.height - 2);
    }
    
    // 动态增强系统：为所有关卡额外添加内容
    addDynamicContent(idx, def);
  }

  function spawnToughEnemy(x, y) {
    const toughEnemy = {
      x: x * TILE,
      y: y * TILE - TILE, // 稍微提高生成位置，避免卡在地里
      w: TILE,
      h: TILE,
      vx: -60 + Math.random() * 20,
      vy: 100, // 给初始向下速度，让它自然落到地面
      onGround: false,
      alive: true,  // 确保敌人是活着的
      spiny: false, // 明确设置为可踩踏
      type: 'tough',
      hits: 0,  // 记录被踩的次数
      maxHits: 2,  // 需要踩两次
      stunTime: 0,  // 眩晕时间
      originalVx: -60  // 原始速度
    };
    enemies.push(toughEnemy);
  }

  // 新增怪物类型

  function spawnSpikedEnemy(x, y) {
    // 全身带刺的敌人：不能踩，不能碰，只能用特殊方式击败
    const spikedEnemy = {
      x: x * TILE,
      y: y * TILE - 28,
      w: 28,
      h: 28,
      vx: 25,
      vy: 0,
      alive: true,
      type: 'spiked',
      spikes: true,
      invulnerable: true, // 完全无敌
      onGround: false,
      timer: 0
    };
    enemies.push(spikedEnemy);
  }

  function spawnGhostEnemy(x, y) {
    // 幽灵敌人：会穿墙，追踪玩家
    const ghostEnemy = {
      x: x * TILE,
      y: y * TILE - 24,
      w: 24,
      h: 24,
      vx: 40,
      vy: 40,
      alive: true,
      type: 'ghost',
      phaseThrough: true, // 穿墙能力
      trackPlayer: true, // 追踪玩家
      alpha: 0.7, // 半透明
      timer: 0
    };
    enemies.push(ghostEnemy);
  }

  function spawnShooterEnemy(x, y) {
    // 射击敌人：会发射子弹
    const shooterEnemy = {
      x: x * TILE,
      y: y * TILE - 26,
      w: 26,
      h: 26,
      vx: 20,
      vy: 0,
      alive: true,
      type: 'shooter',
      shootTimer: 0,
      shootInterval: 2000, // 2秒射击一次
      onGround: false,
      bullets: [] // 子弹数组
    };
    enemies.push(shooterEnemy);
  }

  function spawnJumperEnemy(x, y) {
    // 超级跳跃敌人：会高跳，移动速度快
    const jumperEnemy = {
      x: x * TILE,
      y: y * TILE - 30,
      w: 30,
      h: 30,
      vx: 80,
      vy: 0,
      alive: true,
      type: 'jumper',
      jumpTimer: 0,
      jumpInterval: 1500, // 1.5秒跳一次
      jumpForce: -600, // 跳跃力度
      onGround: false
    };
    enemies.push(jumperEnemy);
  }

  function spawnMiniEnemy(x, y) {
    // 迷你敌人：很小很快，成群出现
    const miniEnemy = {
      x: x * TILE,
      y: y * TILE - 12,
      w: 12,
      h: 12,
      vx: 120 + Math.random() * 40, // 随机速度
      vy: 0,
      alive: true,
      type: 'mini',
      onGround: false,
      swarmId: Date.now() + Math.random() // 群体ID
    };
    enemies.push(miniEnemy);
  }

  function addDynamicContent(idx, def) {
    // 动态增强系统：为关卡添加额外的金币、道具和敌人
    const extraCoinsPerLevel = Math.min(15 + Math.floor(idx / 4), 25); // 每4关增加，最多25个
    const extraMushrooms = Math.min(2 + Math.floor(idx / 6), 4); // 每6关增加，最多4个
    const extraEnemies = Math.min(3 + Math.floor(idx / 3), 8); // 每3关增加，最多8个
    const plannedShooters = Math.min(1 + Math.floor(idx / 5), 6); // 射击怪物数量
    const defenseLines = idx >= 12 ? Math.min(Math.floor((idx - 12) / 6) + 1, 3) : 0; // 防线数量
    
    console.log(`🎯 关卡 ${idx} 动态增强: ${extraCoinsPerLevel}金币, ${extraMushrooms}蘑菇, ${extraEnemies}敌人, ${plannedShooters}射击怪物, ${defenseLines}防线`);
    
    // 添加额外金币 - 随机分布在平台上
    for (let i = 0; i < extraCoinsPerLevel; i++) {
      if (def.platforms && def.platforms.length > 0) {
        const platform = def.platforms[i % def.platforms.length];
        const coinX = platform.x + Math.floor(Math.random() * platform.w);
        const coinY = platform.y - 1;
        if (coinX < def.width && coinY > 0 && getTile(coinX, coinY) === 0) {
          coinTiles.add(coinY * world.width + coinX);
        }
      }
    }
    
    // 添加额外蘑菇道具
    for (let i = 0; i < extraMushrooms; i++) {
      if (def.platforms && def.platforms.length > 0) {
        const platform = def.platforms[(i * 3) % def.platforms.length]; // 间隔分布
        const mushroomX = platform.x + Math.floor(platform.w / 2);
        const mushroomY = platform.y - 1;
        
        // 随机选择道具类型
        const powerUpTypes = ['mushroom', 'mushroom', 'star', 'gem', 'lifeMushroom']; // 添加加生命蘑菇
        const powerUpType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        
        powerUps.push({
          x: mushroomX * TILE + 16,
          y: mushroomY * TILE + 16,
          r: 7,
          type: powerUpType
        });
      }
    }
    
    // 添加额外敌人 - 多种类型混合
    for (let i = 0; i < extraEnemies; i++) {
      const enemyX = 20 + (i * Math.floor(def.width / (extraEnemies + 1)));
      
      // 根据关卡难度调整敌人类型分布 - 增加射击怪物出现频率
      let enemyType;
      if (idx < 4) {
        // 超早期关卡：基础敌人 + 少量射击怪物
        enemyType = ['goomba', 'goomba', 'spiny', 'shooter'][Math.floor(Math.random() * 4)];
      } else if (idx < 8) {
        // 早期关卡：简单敌人为主 + 更多射击怪物
        enemyType = ['goomba', 'spiny', 'flying', 'shooter', 'shooter', 'mini'][Math.floor(Math.random() * 6)];
      } else if (idx < 16) {
        // 中期关卡：射击怪物成为常见敌人
        enemyType = ['goomba', 'spiny', 'flying', 'bouncing', 'tough', 'shooter', 'shooter', 'jumper'][Math.floor(Math.random() * 8)];
      } else if (idx < 24) {
        // 后期关卡：射击怪物大量出现
        enemyType = ['spiny', 'flying', 'bouncing', 'tough', 'shooter', 'shooter', 'shooter', 'jumper', 'spiked'][Math.floor(Math.random() * 9)];
      } else {
        // 终极关卡：射击怪物密集分布
        enemyType = ['tough', 'spiked', 'ghost', 'shooter', 'shooter', 'shooter', 'jumper', 'mini', 'flying'][Math.floor(Math.random() * 9)];
      }
      
      // 生成敌人
      if (enemyType === 'goomba') {
        spawnGoomba(enemyX, world.height - 2, Math.random() > 0.5 ? -1 : 1);
      } else if (enemyType === 'spiny') {
        spawnSpiny(enemyX, world.height - 2, Math.random() > 0.5 ? -1 : 1);
      } else if (enemyType === 'flying') {
        spawnFlyingEnemy(enemyX, 4 + Math.floor(Math.random() * 4));
      } else if (enemyType === 'bouncing') {
        spawnBouncingEnemy(enemyX, world.height - 2);
      } else if (enemyType === 'tough') {
        spawnToughEnemy(enemyX, world.height - 2);
      } else if (enemyType === 'spiked') {
        spawnSpikedEnemy(enemyX, world.height - 2);
      } else if (enemyType === 'ghost') {
        spawnGhostEnemy(enemyX, 6 + Math.floor(Math.random() * 4));
      } else if (enemyType === 'shooter') {
        spawnShooterEnemy(enemyX, world.height - 2);
      } else if (enemyType === 'jumper') {
        spawnJumperEnemy(enemyX, world.height - 2);
      } else if (enemyType === 'mini') {
        // 迷你敌人成群生成
        for (let j = 0; j < 3; j++) {
          spawnMiniEnemy(enemyX + j * 8, world.height - 2);
        }
      }
    }

    // 专门的射击怪物增强生成 - 根据关卡难度增加数量
    const extraShooters = Math.min(1 + Math.floor(idx / 5), 6); // 每5关增加，最多6个
    const shooterPositions = []; // 记录已生成的射击怪物位置，避免过度密集
    
    for (let i = 0; i < extraShooters; i++) {
      let attempts = 0;
      let validPosition = false;
      let shooterX, shooterY;
      
      // 最多尝试10次找到合适位置
      while (!validPosition && attempts < 10) {
        // 随机选择生成位置：地面或平台
        const spawnOnPlatform = Math.random() > 0.4 && def.platforms && def.platforms.length > 0;
        
        if (spawnOnPlatform) {
          // 在平台上生成射击怪物
          const platform = def.platforms[Math.floor(Math.random() * def.platforms.length)];
          shooterX = platform.x + Math.floor(Math.random() * Math.max(1, platform.w - 1));
          shooterY = platform.y - 1;
        } else {
          // 在地面生成射击怪物
          shooterX = 30 + Math.floor(Math.random() * (def.width - 60));
          shooterY = world.height - 2;
        }
        
        // 检查与其他射击怪物的距离（最小距离40像素）
        validPosition = shooterPositions.every(pos => 
          Math.abs(pos.x - shooterX) > 40 || Math.abs(pos.y - shooterY) > 2
        );
        attempts++;
      }
      
      if (validPosition) {
        spawnShooterEnemy(shooterX, shooterY);
        shooterPositions.push({x: shooterX, y: shooterY});
        console.log(`生成射击怪物 ${i+1}: (${shooterX}, ${shooterY})`);
      }
    }

    // 平台上随机生成怪物
    if (def.platforms && def.platforms.length > 0) {
      const platformEnemies = Math.min(2 + Math.floor(idx / 8), 4); // 平台敌人数量
      
      for (let i = 0; i < platformEnemies; i++) {
        const platform = def.platforms[Math.floor(Math.random() * def.platforms.length)];
        const platformX = platform.x + Math.floor(Math.random() * Math.max(1, platform.w - 2));
        const platformY = platform.y - 1;
        
        // 平台上的敌人类型 - 大幅增加射击怪物概率
        let platformEnemyType;
        if (idx < 8) {
          platformEnemyType = ['goomba', 'spiny', 'flying', 'shooter', 'shooter'][Math.floor(Math.random() * 5)];
        } else if (idx < 16) {
          platformEnemyType = ['flying', 'bouncing', 'mini', 'shooter', 'shooter', 'jumper'][Math.floor(Math.random() * 6)];
        } else {
          platformEnemyType = ['flying', 'ghost', 'shooter', 'shooter', 'shooter', 'spiked', 'jumper'][Math.floor(Math.random() * 7)];
        }
        
        // 在平台上生成敌人
        if (platformEnemyType === 'goomba') {
          spawnGoomba(platformX, platformY, Math.random() > 0.5 ? -1 : 1);
        } else if (platformEnemyType === 'spiny') {
          spawnSpiny(platformX, platformY, Math.random() > 0.5 ? -1 : 1);
        } else if (platformEnemyType === 'flying') {
          spawnFlyingEnemy(platformX, platformY - 2);
        } else if (platformEnemyType === 'bouncing') {
          spawnBouncingEnemy(platformX, platformY);
        } else if (platformEnemyType === 'ghost') {
          spawnGhostEnemy(platformX, platformY - 1);
        } else if (platformEnemyType === 'shooter') {
          spawnShooterEnemy(platformX, platformY);
        } else if (platformEnemyType === 'spiked') {
          spawnSpikedEnemy(platformX, platformY);
        } else if (platformEnemyType === 'jumper') {
          spawnJumperEnemy(platformX, platformY);
        } else if (platformEnemyType === 'mini') {
          // 在平台上生成迷你敌人群
          for (let j = 0; j < 2; j++) {
            if (platformX + j * 6 < platform.x + platform.w) {
              spawnMiniEnemy(platformX + j * 6, platformY);
            }
          }
        }
      }
    }

    // 在中后期关卡创建射击怪物"防线"区域
    if (idx >= 12) {
      const defenseLines = Math.min(Math.floor((idx - 12) / 6) + 1, 3); // 最多3条防线
      
      for (let line = 0; line < defenseLines; line++) {
        const lineX = Math.floor(def.width * 0.3) + (line * Math.floor(def.width * 0.2));
        const shootersInLine = 2 + Math.floor(idx / 15); // 每条防线的射击怪物数量
        
        for (let s = 0; s < shootersInLine; s++) {
          const shooterX = lineX + (s * 24); // 间隔分布
          
          // 60%概率在地面，40%概率在平台上
          if (Math.random() > 0.6 && def.platforms && def.platforms.length > 0) {
            // 寻找附近的平台
            const nearbyPlatforms = def.platforms.filter(p => 
              Math.abs(p.x + p.w/2 - shooterX) < 50
            );
            if (nearbyPlatforms.length > 0) {
              const platform = nearbyPlatforms[Math.floor(Math.random() * nearbyPlatforms.length)];
              const platformX = platform.x + Math.floor(Math.random() * Math.max(1, platform.w - 1));
              spawnShooterEnemy(platformX, platform.y - 1);
              console.log(`防线${line+1}平台射击怪物: (${platformX}, ${platform.y - 1})`);
            } else {
              // 平台不合适，在地面生成
              spawnShooterEnemy(shooterX, world.height - 2);
              console.log(`防线${line+1}地面射击怪物: (${shooterX}, ${world.height - 2})`);
            }
          } else {
            // 在地面生成
            spawnShooterEnemy(shooterX, world.height - 2);
            console.log(`防线${line+1}地面射击怪物: (${shooterX}, ${world.height - 2})`);
          }
        }
      }
      
      console.log(`关卡 ${idx}: 创建了 ${defenseLines} 条射击怪物防线`);
    }
  }

  function loadLevel(idx) {
    currentLevel = Math.max(0, Math.min(idx | 0, levelDefs.length - 1)); // 确保关卡索引在有效范围内
    buildLevel(currentLevel);
    resetGame(false); // 重置游戏状态但不重建关卡
  }

  // Collision helpers
  function rectVsWorld(px, py, w, h) {
    const left = Math.floor(px / TILE);
    const right = Math.floor((px + w) / TILE);
    const top = Math.floor(py / TILE);
    const bottom = Math.floor((py + h) / TILE);
    const hits = [];
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const t = getTile(x, y);
        if (t === 1) hits.push({ x, y, t });
        if (t === 2) hits.push({ x, y, t });
      }
    }
    return hits;
  }

  function resolveCollisions(entity) {
    const hits = rectVsWorld(entity.x, entity.y, entity.w, entity.h);
    entity.onGround = false;
    for (const h of hits) {
      if (h.t === 1) {
        // Solid block
        const blockRect = { x: h.x * TILE, y: h.y * TILE, w: TILE, h: TILE };
        const ox = (entity.x + entity.w / 2) - (blockRect.x + TILE / 2);
        const oy = (entity.y + entity.h / 2) - (blockRect.y + TILE / 2);
        const dx = (TILE / 2 + entity.w / 2) - Math.abs(ox);
        const dy = (TILE / 2 + entity.h / 2) - Math.abs(oy);
        if (dx < dy) {
          // resolve x
          if (ox > 0) entity.x += dx; else entity.x -= dx;
          entity.vx = 0;
                 } else {
           // resolve y
           if (oy > 0) { entity.y += dy; entity.vy = 0; }
           else { entity.y -= dy; entity.vy = 0; entity.onGround = true; entity.jumpCount = 0; }
         }
      } else if (h.t === 2 && entity === player) {
        // Goal tile
        if (!player.win) {
          player.win = true;
          if (!winSfxPlayed) { sfx.win(); winSfxPlayed = true; }
          // show modal and save progress
          try {
            const totalScore = (parseInt(localStorage.getItem('totalScore')||'0',10)||0) + score;
            const totalCoins = (parseInt(localStorage.getItem('totalCoins')||'0',10)||0) + coins;
            localStorage.setItem('totalScore', String(totalScore));
            localStorage.setItem('totalCoins', String(totalCoins));
            const highest = Math.max(currentLevel + 1, parseInt(localStorage.getItem('highestLevel')||'1',10)||1);
            localStorage.setItem('highestLevel', String(highest));
          } catch(e){}
          const modal = document.getElementById('clear-modal');
          const stats = document.getElementById('clear-stats');
          if (stats) stats.textContent = `分数：${score}｜金币：${coins}`;
          if (modal) modal.setAttribute('aria-hidden','false');
        }
      }
    }
  }

  function resetGame(rebuild) {
    if (rebuild) buildLevel(currentLevel);
    player.x = 3 * TILE; player.y = (world.height - 4) * TILE;
    player.vx = 0; player.vy = 0; player.alive = true; player.win = false; player.jumpCount = 0; cameraX = 0;
    deathSfxPlayed = false; winSfxPlayed = false;
    jumpPressed = false;
    if (rebuild) {
      spawnLevelEnemies(currentLevel);
      coins = 0; score = 0;
      sfx.levelStart(); // 播放关卡开始音效
      updateMusicForLevel(currentLevel); // 根据关卡更新音乐
    }
    
    // 重置新增状态
    playerSize = 1;
    playerSpeed = 1;
    invincible = false;
    invincibleTimer = 0;
    combo = 0;
    comboTimer = 0;
    particles.length = 0;
    
    // 重置生命系统
    lives = maxLives;
    gameOver = false;
  }
  
  // 生命损失处理函数
  function loseLife() {
    lives--;
    console.log('生命数减少，剩余生命：', lives);
    
    if (lives <= 0) {
      gameOver = true;
      player.alive = false;
      sfx.gameOver();
      console.log('游戏结束');
    } else {
      sfx.loseLife();
      // 设置无敌状态但不重置位置
      invincible = true;
      invincibleTimer = 2.0; // 失去生命后2秒无敌时间
      combo = 0; // 重置连击
      comboTimer = 0;
      
      // 创建失去生命的粒子效果
      for (let i = 0; i < 15; i++) {
        createParticle(
          player.x + player.w/2, player.y + player.h/2,
          (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300,
          '#ff1744', 1.2
        );
      }
    }
  }
  
  // 验证游戏状态函数
  function validateGameState() {
    // 确保玩家位置在合理范围内
    if (player.x < 0) player.x = 0;
    if (player.x > world.width * TILE) player.x = world.width * TILE - player.w;
    
    // 确保速度不会过大
    player.vx = clamp(player.vx, -1000, 1000);
    player.vy = clamp(player.vy, -2000, 2000);
    
    // 确保跳跃计数有效
    if (player.jumpCount < 0) player.jumpCount = 0;
    if (player.jumpCount > player.maxJumps) player.jumpCount = player.maxJumps;
    
    // 确保倍数在合理范围内
    playerSize = clamp(playerSize, 0.5, 3);
    playerSpeed = clamp(playerSpeed, 0.5, 2);
    
    // 确保计时器为正数
    if (invincibleTimer < 0) {
      invincibleTimer = 0;
      invincible = false;
    }
    if (comboTimer < 0) {
      comboTimer = 0;
      combo = 0;
    }
    
    // 确保生命数在有效范围内
    if (lives < 0) lives = 0;
    if (lives > maxLives) lives = maxLives;
  }

  // Input handling
  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (!k) return;
    if (k === 'pause') { togglePause(); e.preventDefault(); return; }
    if (k === 'restart') { resetGame(); e.preventDefault(); return; }
    keys[k] = true;
    if (k === 'jump' || k === 'up') {
      keys.up = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (!k) return;
    keys[k] = false;
    if (k === 'jump' || k === 'up') {
      keys.up = false;
      jumpPressed = false;
    }
  });

  const btnPause = document.getElementById('btn-pause');
  const btnRestart = document.getElementById('btn-restart');
  const btnAudio = document.getElementById('btn-audio');
  const btnMusic = document.getElementById('btn-music');
  const selLevel = document.getElementById('level-select');
  const btnNext = document.getElementById('btn-next');
  const btnRetry2 = document.getElementById('btn-retry2');
  
  // 音频设置面板元素
  const btnAudioSettings = document.getElementById('btn-audio-settings');
  const audioSettingsPanel = document.getElementById('audio-settings-panel');
  const closeAudioSettings = document.getElementById('close-audio-settings');
  const resetAudioSettings = document.getElementById('reset-audio-settings');
  const musicVolumeSlider = document.getElementById('music-volume-slider');
  const sfxVolumeSlider = document.getElementById('sfx-volume-slider');
  const musicVolumeDisplay = document.getElementById('music-volume-display');
  const sfxVolumeDisplay = document.getElementById('sfx-volume-display');
  const musicTrackSelect = document.getElementById('music-track-select');
  const toggleAllAudio = document.getElementById('toggle-all-audio');
  const testAudio = document.getElementById('test-audio');
  const toggleHaptic = document.getElementById('toggle-haptic');
  btnPause?.addEventListener('click', () => { ensureAudio(); togglePause(); });
  btnRestart?.addEventListener('click', () => { ensureAudio(); resetGame(true); });
  btnAudio?.addEventListener('click', () => {
    ensureAudio(); 
    audioEnabled = !audioEnabled; 
    btnAudio.textContent = `音效: ${audioEnabled ? '开' : '关'}`;
    saveAudioSettings();
    sfx.buttonClick();
  });
  btnMusic?.addEventListener('click', () => {
    ensureAudio(); 
    musicEnabled = !musicEnabled; 
    btnMusic.textContent = `音乐: ${musicEnabled ? '开' : '关'}`;
    if (musicEnabled) { loadBgm(); startMusic(); } else { stopMusic(); }
    saveAudioSettings();
    sfx.buttonClick();
  });
  selLevel?.addEventListener('change', (e) => {
    const v = parseInt(e.target.value || '0', 10) || 0; loadLevel(v); resetGame(true);
  });
  canvas.addEventListener('pointerdown', () => { ensureAudio(); loadBgm(); if (musicEnabled) startMusic(); }, { passive: true });
  window.addEventListener('load', () => { 
    loadAudioSettings(); // 加载音频设置
    initAudioSettingsPanel(); // 初始化音频设置面板
    // 更新按钮文本
    if (btnAudio) btnAudio.textContent = `音效: ${audioEnabled ? '开' : '关'}`;
    if (btnMusic) btnMusic.textContent = `音乐: ${musicEnabled ? '开' : '关'}`;
    setTimeout(() => { try { loadBgm(); } catch(e){} }, 200); 
  });
  btnNext?.addEventListener('click', () => {
    const modal = document.getElementById('clear-modal');
    modal?.setAttribute('aria-hidden','true');
    const next = Math.min(currentLevel + 1, levelDefs.length - 1);
    loadLevel(next); resetGame(true);
    const sel = document.getElementById('level-select');
    if (sel && sel.tagName === 'SELECT') sel.value = String(next);
  });
  btnRetry2?.addEventListener('click', () => {
    document.getElementById('clear-modal')?.setAttribute('aria-hidden','true');
    resetGame(true);
  });

  // Game loop
  let last = performance.now();
  let paused = false;
  function togglePause() { paused = !paused; }

  let deathSfxPlayed = false, winSfxPlayed = false;
  function update(dt) {
    if (!player.alive || player.win) return;

    // First: refresh ground contact before processing new input
    resolveCollisions(player);

    // Horizontal movement
    let ax = 0;
    if (keys.left) ax -= moveSpeed * playerSpeed;
    if (keys.right) ax += moveSpeed * playerSpeed;
    player.vx = ax;
    player.x += player.vx * dt;

    // Jump handling - check if jump key is pressed and we can jump
    if ((keys.up || keys.jump) && player.jumpCount < player.maxJumps && !jumpPressed) {
      player.vy = -jumpVelocity;
      player.onGround = false;
      player.jumpCount++;
      jumpPressed = true;
      
      // Different sound for double jump
      if (player.jumpCount === 1) {
        sfx.jump();
      } else {
        sfx.doubleJump();
      }
    }

    // Gravity + Vertical integration
    player.vy += gravity * dt;
    player.vy = clamp(player.vy, -Infinity, terminalVy);
    player.y += player.vy * dt;

    // Resolve collisions after vertical move
    resolveCollisions(player);
    
    // 浮动平台碰撞检测
    for (const fp of floatingPlatforms) {
      if (player.x < fp.x + fp.w && player.x + player.w > fp.x &&
          player.y < fp.y + fp.h && player.y + player.h > fp.y) {
        // 从上方碰撞
        if (player.vy > 0 && player.y < fp.y) {
          player.y = fp.y - player.h;
          if (player.vy > 200) { // 只有在快速下落时播放音效
            sfx.platformLand();
          }
          player.vy = 0;
          player.onGround = true;
          player.jumpCount = 0;
        }
      }
    }

    // Enemies
    for (const g of enemies) {
      if (!g.alive) continue;
      

      
      // Tough敌人眩晕状态处理
      if (g.type === 'tough' && g.stunTime > 0) {
        g.stunTime -= dt;
        g.vx = 0; // 眩晕时停止移动
        // 眩晕结束后恢复移动
        if (g.stunTime <= 0) {
          g.vx = g.originalVx;
        }
      }
      
      // 特殊敌人行为
      if (g.flying) {
        // 飞行敌人：上下飞行
        g.timer = (g.timer || 0) + dt;
        g.y = g.flyHeight + Math.sin(g.timer * 2) * g.flyRange;
        g.x += g.vx * dt;
        // 改变方向
        if (g.x < 0 || g.x > world.width * TILE) g.vx *= -1;
      } else if (g.bouncing) {
        // 弹跳敌人：定期跳跃
        g.bounceTimer += dt;
        if (g.bounceTimer >= g.bounceInterval) {
          g.vy = -400;
          g.bounceTimer = 0;
        }
        g.vy += gravity * dt;
        g.y += g.vy * dt;
        g.x += g.vx * dt;
        
        // 地面碰撞检测
        const groundY = (world.height - 2) * TILE;
        if (g.y + g.h >= groundY) {
          g.y = groundY - g.h;
          g.vy = 0;
          g.onGround = true;
        } else {
          g.onGround = false;
        }
        // 改变方向
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor((g.y + g.h - 1) / TILE));
        if (tAhead === 1 || tAhead === 2) g.vx *= -1;
      } else if (g.type === 'tough') {
        // Tough敌人：地面行走，具有重力和碰撞
        // 应用重力（如果不在眩晕状态）
        if (g.stunTime <= 0) {
          g.vy += gravity * dt * 0.5; // 轻微重力
        }
        
        // 垂直移动
        g.y += g.vy * dt;
        
        // 地面碰撞检测
        const groundY = (world.height - 2) * TILE;
        if (g.y + g.h >= groundY) {
          g.y = groundY - g.h;
          g.vy = 0;
          g.onGround = true;
        } else {
          g.onGround = false;
        }
        
        // 水平移动（除非眩晕）
        if (g.stunTime <= 0) {
          g.x += g.vx * dt;
          
          // 墙壁碰撞检测
          const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
          const footY = g.y + g.h - 1;
          const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor(footY / TILE));
          const tEdge = getTile(Math.floor((g.x + g.w / 2) / TILE), Math.floor((g.y + g.h + 2) / TILE));
          
          // 遇到墙壁或悬崖时转向
          if (tAhead === 1 || tAhead === 2 || tEdge === 0) {
            g.vx *= -1;
            g.originalVx *= -1; // 同时更新原始速度
          }
        }
      } else if (g.type === 'ghost') {
        // 幽灵敌人：追踪玩家，穿墙
        g.timer = (g.timer || 0) + dt;
        
        // 追踪玩家
        const dx = player.x - g.x;
        const dy = player.y - g.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          g.vx = (dx / distance) * 50; // 追踪速度
          g.vy = (dy / distance) * 50;
        }
        
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        
        // 幽灵效果：轻微漂浮
        g.y += Math.sin(g.timer * 3) * 0.5;
        
      } else if (g.type === 'shooter') {
        // 射击敌人：定期射击
        g.shootTimer += dt * 1000; // 转换为毫秒
        
        // 地面移动
        g.x += g.vx * dt;
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const footY = g.y + g.h - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor(footY / TILE));
        const tEdge = getTile(Math.floor((g.x + g.w / 2) / TILE), Math.floor((g.y + g.h + 2) / TILE));
        if (tAhead === 1 || tAhead === 2 || tEdge === 0) g.vx *= -1;
        
        // 射击逻辑
        if (g.shootTimer >= g.shootInterval) {
          // 朝玩家方向射击
          const dx = player.x - g.x;
          const dy = player.y - g.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < 300 && distance > 0) { // 射击范围
            g.bullets = g.bullets || [];
            g.bullets.push({
              x: g.x + g.w / 2,
              y: g.y + g.h / 2,
              w: 6, // 子弹宽度
              h: 6, // 子弹高度
              vx: (dx / distance) * 200,
              vy: (dy / distance) * 200,
              life: 3000 // 3秒生命周期
            });
            g.shootTimer = 0;
            sfx.bulletFire(); // 播放射击音效
          }
        }
        
        // 更新子弹
        if (g.bullets) {
          g.bullets.forEach(bullet => {
            bullet.x += bullet.vx * dt;
            bullet.y += bullet.vy * dt;
            bullet.life -= dt * 1000;
          });
          g.bullets = g.bullets.filter(bullet => bullet.life > 0);
        }
        
      } else if (g.type === 'jumper') {
        // 跳跃敌人：定期高跳
        g.jumpTimer += dt * 1000;
        
        // 应用重力
        g.vy += gravity * dt;
        g.y += g.vy * dt;
        g.x += g.vx * dt;
        
        // 地面碰撞
        const groundY = (world.height - 2) * TILE;
        if (g.y + g.h >= groundY) {
          g.y = groundY - g.h;
          g.vy = 0;
          g.onGround = true;
        } else {
          g.onGround = false;
        }
        
        // 跳跃逻辑
        if (g.jumpTimer >= g.jumpInterval && g.onGround) {
          g.vy = g.jumpForce;
          g.jumpTimer = 0;
        }
        
        // 墙壁碰撞
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor((g.y + g.h - 1) / TILE));
        if (tAhead === 1 || tAhead === 2) g.vx *= -1;
        
      } else if (g.type === 'spiked') {
        // 全身带刺敌人：慢速移动，无敌
        g.timer = (g.timer || 0) + dt;
        g.x += g.vx * dt;
        
        // 发光效果计时
        g.glowIntensity = 0.5 + Math.sin(g.timer * 4) * 0.3;
        
        // 墙壁碰撞
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const footY = g.y + g.h - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor(footY / TILE));
        const tEdge = getTile(Math.floor((g.x + g.w / 2) / TILE), Math.floor((g.y + g.h + 2) / TILE));
        if (tAhead === 1 || tAhead === 2 || tEdge === 0) g.vx *= -1;
        
      } else if (g.type === 'mini') {
        // 迷你敌人：快速移动
        g.x += g.vx * dt;
        
        // 墙壁碰撞
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const footY = g.y + g.h - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor(footY / TILE));
        const tEdge = getTile(Math.floor((g.x + g.w / 2) / TILE), Math.floor((g.y + g.h + 2) / TILE));
        if (tAhead === 1 || tAhead === 2 || tEdge === 0) g.vx *= -1;
        
      } else {
        // 普通敌人
        g.x += g.vx * dt;
        // change direction when hitting solid
        const aheadX = g.vx > 0 ? g.x + g.w + 1 : g.x - 1;
        const footY = g.y + g.h - 1;
        const tAhead = getTile(Math.floor(aheadX / TILE), Math.floor(footY / TILE));
        const tEdge = getTile(Math.floor((g.x + g.w / 2) / TILE), Math.floor((g.y + g.h + 2) / TILE));
        if (tAhead === 1 || tAhead === 2 || tEdge === 0) g.vx *= -1;
      }

      // collide with player
      if (aabb(g, player) && !invincible) {
        // Check if player is falling and hitting enemy from above
        const playerBottom = player.y + player.h;
        const enemyTop = g.y;
        const playerCenterX = player.x + player.w / 2;
        const enemyCenterX = g.x + g.w / 2;
        
        // Player is falling and hitting enemy from above (within reasonable distance)
        const canStomp = !g.spiny && 
                        !g.spikes && 
                        !g.invulnerable &&
                        g.type !== 'spiked' &&
                        g.type !== 'ghost' &&
                        player.vy > 0 && 
                        playerBottom - enemyTop < 20 && 
                        Math.abs(playerCenterX - enemyCenterX) < g.w;
        
        // 调试信息
        if (g.type === 'tough' && aabb(g, player)) {
          console.log(`Tough敌人碰撞检测: canStomp=${canStomp}, spiny=${g.spiny}, playerVy=${player.vy}, distance=${playerBottom - enemyTop}`);
        }
        
        if (canStomp) {
          // 检查是否是tough敌人
          if (g.type === 'tough') {
            g.hits++;
            console.log(`Tough敌人被踩踏! 当前hits: ${g.hits}/${g.maxHits}`);
            if (g.hits >= g.maxHits) {
              // 第二次击中，消灭敌人
              g.alive = false;
              score += 400 * combo; // tough敌人奖励更高
              sfx.toughKill(); // 特殊击杀音效
              
              // 特殊粒子效果（金色）
              for (let i = 0; i < 12; i++) {
                createParticle(
                  g.x + g.w/2, g.y + g.h/2,
                  (Math.random() - 0.5) * 250, (Math.random() - 0.5) * 250,
                  '#ffdd00', 1.0
                );
              }
            } else {
              // 第一次击中，进入眩晕状态
              g.stunTime = 1.5; // 眩晕1.5秒
              score += 100 * combo; // 第一次击中的分数
              sfx.toughHit(); // 击中音效
              
              // 击中粒子效果（橙色）
              for (let i = 0; i < 6; i++) {
                createParticle(
                  g.x + g.w/2, g.y + g.h/2,
                  (Math.random() - 0.5) * 150, (Math.random() - 0.5) * 150,
                  '#ff8800', 0.6
                );
              }
            }
          } else {
            // 普通敌人，一次踩踏即死
            g.alive = false;
            score += 200 * combo; // 连击奖励
            playMobileOptimizedSfx(() => sfx.stomp(), 'stomp');
            
            // 创建粒子效果
            for (let i = 0; i < 8; i++) {
              createParticle(
                g.x + g.w/2, g.y + g.h/2,
                (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200,
                '#ffd700', 0.8
              );
            }
          }
          
          player.vy = -jumpVelocity * 0.6;
          player.jumpCount = 0; // Reset jumps when stomping
          combo++;
          comboTimer = 2.0; // 2秒连击时间
          sfx.combo(combo); // 连击音效
        } else {
          if (!invincible) {
            // 检查是否处于巨大化状态
            if (playerSize > 1) {
              // 巨大化状态下不扣生命，而是变小并获得无敌时间
              playerSize = 1; // 变回正常大小
              playerSpeed = 1; // 重置速度
              invincible = true;
              invincibleTimer = 2.0; // 变小后2秒无敌时间
              combo = 0; // 重置连击
              comboTimer = 0;
              sfx.powerDown(); // 播放变小音效
              
              // 创建变小粒子效果
              for (let i = 0; i < 12; i++) {
                createParticle(
                  player.x + player.w/2, player.y + player.h/2,
                  (Math.random() - 0.5) * 250, (Math.random() - 0.5) * 250,
                  '#ff9800', 1.0
                );
              }
              console.log('巨大化状态抵消伤害，变回正常大小');
            } else {
              // 正常大小时扣除一条生命
              loseLife();
            }
          }
        }
      }
      
      // 检查子弹碰撞
      if (g.bullets && g.bullets.length > 0) {
        g.bullets.forEach(bullet => {
          if (aabb(bullet, player) && !invincible) {
            // 子弹击中玩家 - 直接扣生命并给予无敌时间
            loseLife(); // 扣除一条生命
            invincible = true; // 立即进入无敌状态
            invincibleTimer = 2.0; // 2秒无敌时间
            
            // 播放子弹击中音效
            sfx.bulletHit();
            
            // 创建被击中的粒子效果
            for (let i = 0; i < 8; i++) {
              createParticle(
                player.x + player.w/2, 
                player.y + player.h/2,
                (Math.random() - 0.5) * 300, 
                (Math.random() - 0.5) * 300,
                '#ff4444', 
                1.0
              );
            }
            
            bullet.life = 0; // 子弹消失
            console.log('被子弹击中！扣除1条生命，获得2秒无敌时间');
          }
        });
      }
    }

          // Death by falling into pits (掉入虚空扣一格生命并重置位置)
      if (player.y > (world.height + 2) * TILE) { 
        if (!invincible) {
          loseLife(); // 扣除一条生命
        }
        // 重置玩家位置到安全位置
        player.x = 3 * TILE;
        player.y = (world.height - 4) * TILE;
        player.vx = 0;
        player.vy = 0;
        console.log('掉入虚空，损失一条生命');
      }
    
    // 更新状态
    if (invincible) {
      invincibleTimer -= dt;
      if (invincibleTimer <= 0) {
        invincible = false;
      }
    }
    
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 0;
      }
    }
    
    // 更新粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt; // 重力
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }
    
    // 更新浮动平台
    for (const fp of floatingPlatforms) {
      fp.timer += dt;
      fp.x = fp.startX + Math.sin(fp.timer * fp.speed) * fp.moveX * 50;
      fp.y = fp.startY + Math.sin(fp.timer * fp.speed) * fp.moveY * 30;
    }
    
    // 更新收集品
    for (const c of collectibles) {
      c.bobTimer += dt;
      c.y += Math.sin(c.bobTimer * 3) * 0.5;
    }

    // Coin collection
    const ctx = Math.floor((player.x + player.w / 2) / TILE);
    const cty = Math.floor((player.y + player.h / 2) / TILE);
    const cid = cty * world.width + ctx;
    if (coinTiles.has(cid)) {
      coinTiles.delete(cid);
      coins += 1; score += 100; 
      playMobileOptimizedSfx(() => sfx.coin(), 'collect');
    }
    // Power-up collection (circle-rect)
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const pu = powerUps[i];
      const nx = clamp(pu.x, player.x, player.x + player.w);
      const ny = clamp(pu.y, player.y, player.y + player.h);
      const dx = pu.x - nx, dy = pu.y - ny;
      if (dx * dx + dy * dy <= pu.r * pu.r) {
        score += 300; 
        playMobileOptimizedSfx(() => sfx.powerUp(), 'success'); // 道具音效
        
        // 蘑菇效果
        if (pu.type === 'mushroom') {
          playerSize = Math.min(2, playerSize + 0.3);
          playerSpeed = Math.min(1.5, playerSpeed + 0.2);
          // 创建粒子效果
          for (let i = 0; i < 15; i++) {
            createParticle(
              pu.x, pu.y,
              (Math.random() - 0.5) * 150, (Math.random() - 0.5) * 150,
              '#ff3b30', 1.0
            );
          }
        }
        
        // 加生命蘑菇效果
        if (pu.type === 'lifeMushroom') {
          if (lives < maxLives) {
            // 生命未满，恢复一格生命
            lives++;
            sfx.lifeRestore(); // 专用音效
            // 创建绿色治疗粒子效果
            for (let i = 0; i < 20; i++) {
              createParticle(
                pu.x, pu.y,
                (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180,
                '#4caf50', 1.2
              );
            }
          } else {
            // 生命已满，获得2秒无敌状态
            invincible = true;
            invincibleTimer = 2.0;
            sfx.invincibilityBonus(); // 专用音效
            // 创建金色无敌粒子效果
            for (let i = 0; i < 25; i++) {
              createParticle(
                pu.x, pu.y,
                (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200,
                '#ffeb3b', 1.5
              );
            }
          }
        }
        
        powerUps.splice(i, 1);
      }
    }
    
    // 收集品收集
    for (let i = collectibles.length - 1; i >= 0; i--) {
      const c = collectibles[i];
      if (c.collected) continue;
      
      const dx = c.x - (player.x + player.w/2);
      const dy = c.y - (player.y + player.h/2);
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      if (distance <= c.r + player.w/2) {
        c.collected = true;
        if (c.type === 'star') {
          score += 500;
          invincible = true;
          invincibleTimer = 5.0; // 5秒无敌
          sfx.star(); // 星星音效
          // 星星粒子效果
          for (let i = 0; i < 20; i++) {
            createParticle(
              c.x, c.y,
              (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200,
              '#ffd700', 1.5
            );
          }
        } else if (c.type === 'gem') {
          score += 300;
          coins += 5;
          sfx.gem(); // 宝石音效
          // 宝石粒子效果
          for (let i = 0; i < 12; i++) {
            createParticle(
              c.x, c.y,
              (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180,
              '#00d4ff', 1.0
            );
          }
        }
      }
    }

    // Camera follows player
    const margin = W * 0.35;
    const target = clamp(player.x - margin, 0, world.width * TILE - W);
    cameraX += (target - cameraX) * Math.min(1, dt * 6);
    
    // 验证游戏状态
    validateGameState();
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Rendering
  function draw() {
    try {
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      
      // 绘制天空背景
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(0, 0, W, H);

      // sky gradient already in CSS background; draw parallax clouds/hills
      drawParallax();

      ctx.translate(-Math.floor(cameraX), 0);
      drawWorld();
      drawFloatingPlatforms();
      drawEnemies();
      drawPlayer();
      drawCollectibles();
      drawParticles();

      ctx.restore();

      drawUI();
    } catch (error) {
      console.error('渲染错误:', error);
      // 重置画布状态
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.font = '20px Arial';
      ctx.fillText('游戏渲染出错，请刷新页面重试', 50, H/2);
      ctx.restore();
    }
  }
  
  function drawFloatingPlatforms() {
    ctx.fillStyle = '#8bc34a';
    for (const fp of floatingPlatforms) {
      ctx.fillRect(fp.x, fp.y, fp.w, fp.h);
      // 边框
      ctx.strokeStyle = '#689f38';
      ctx.lineWidth = 2;
      ctx.strokeRect(fp.x, fp.y, fp.w, fp.h);
    }
  }
  
  function drawCollectibles() {
    for (const c of collectibles) {
      if (c.collected) continue;
      
      if (c.type === 'star') {
        // 星星
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        const spikes = 5;
        for (let i = 0; i < spikes * 2; i++) {
          const angle = (i * Math.PI) / spikes;
          const radius = i % 2 === 0 ? c.r : c.r * 0.5;
          const x = c.x + Math.cos(angle) * radius;
          const y = c.y + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      } else if (c.type === 'gem') {
        // 优化宝石设计 - 多彩旋转效果
        const time = Date.now() * 0.005;
        const rotation = time + c.x * 0.01;
        const sparkle = Math.sin(time * 2) * 0.3 + 0.7;
        
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(rotation);
        
        // 宝石发光外圈
        ctx.shadowColor = '#e91e63';
        ctx.shadowBlur = 12 * sparkle;
        
        // 多层宝石渐变
        const gemGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, c.r);
        gemGradient.addColorStop(0, '#ff4081');
        gemGradient.addColorStop(0.6, '#e91e63');
        gemGradient.addColorStop(1, '#8e24aa');
        
        // 宝石主体（钻石形状）
        ctx.fillStyle = gemGradient;
        ctx.beginPath();
        ctx.moveTo(0, -c.r);
        ctx.lineTo(c.r * 0.7, -c.r * 0.3);
        ctx.lineTo(c.r * 0.5, c.r);
        ctx.lineTo(-c.r * 0.5, c.r);
        ctx.lineTo(-c.r * 0.7, -c.r * 0.3);
        ctx.closePath();
        ctx.fill();
        
        // 宝石内部反光
        ctx.fillStyle = `rgba(255, 255, 255, ${sparkle * 0.8})`;
        ctx.beginPath();
        ctx.moveTo(-c.r * 0.3, -c.r * 0.6);
        ctx.lineTo(c.r * 0.2, -c.r * 0.4);
        ctx.lineTo(0, c.r * 0.2);
        ctx.lineTo(-c.r * 0.2, -c.r * 0.1);
        ctx.closePath();
        ctx.fill();
        
        // 中心闪烁亮点
        ctx.fillStyle = `rgba(255, 255, 255, ${sparkle})`;
        ctx.beginPath();
        ctx.arc(-c.r * 0.2, -c.r * 0.3, 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }
    }
  }
  
  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  function drawParallax() {
    const baseY = H - 120;
    ctx.fillStyle = '#3fb24f';
    ctx.fillRect(0, baseY, W, 200);
    // hills
    ctx.fillStyle = '#37a246';
    for (let i = -1; i < 5; i++) {
      const x = (i * 260 - (cameraX * 0.3) % 260);
      drawHill(x, baseY, 220, 90);
    }
    // clouds
    for (let i = -1; i < 7; i++) {
      const x = (i * 200 - (cameraX * 0.15) % 200);
      drawCloud(x, 70, 1.0);
      drawCloud(x + 100, 120, 0.8);
    }
  }
  function drawHill(x, baseY, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + w / 2, baseY - h, x + w, baseY);
    ctx.closePath();
    ctx.fill();
  }
  function drawCloud(x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 18 * s, y - 6 * s, 14 * s, 0, Math.PI * 2);
    ctx.arc(x + 36 * s, y, 16 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorld() {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const t = getTile(x, y);
        if (!t) continue;
        const px = x * TILE; const py = y * TILE;
        if (t === 1) {
          // brick block
          ctx.fillStyle = '#b85c38';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = '#8d3d25';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#d97a4e';
          for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(px + 4, py + i * 8);
            ctx.lineTo(px + TILE - 4, py + i * 8);
            ctx.stroke();
          }
        } else if (t === 2) {
          // flag
          ctx.fillStyle = '#7cfc00';
          ctx.fillRect(px + TILE / 2 - 2, py - 7 * TILE, 4, 7 * TILE);
          ctx.fillStyle = '#ffef00';
          ctx.beginPath();
          ctx.moveTo(px + TILE / 2 + 2, py - TILE * 6.3);
          ctx.lineTo(px + TILE / 2 + 2 + 22, py - TILE * 6.0);
          ctx.lineTo(px + TILE / 2 + 2, py - TILE * 5.7);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // coins
    for (const id of coinTiles) {
      const cx = id % world.width; const cy = Math.floor(id / world.width);
      const px = cx * TILE + 16; const py = cy * TILE + 16;
      // 优化金币渲染 - 动态闪烁效果
      const time = Date.now() * 0.008;
      const bobOffset = Math.sin(time + px * 0.1) * 2;
      const coinY = py + bobOffset;
      
      // 金币发光效果
      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 12;
      
      // 金币渐变
      const coinGradient = ctx.createRadialGradient(px, coinY, 0, px, coinY, 8);
      coinGradient.addColorStop(0, '#fff44f');
      coinGradient.addColorStop(0.7, '#ffd700');
      coinGradient.addColorStop(1, '#ffb300');
      
      // 主体金币
      ctx.fillStyle = coinGradient;
      ctx.beginPath();
      ctx.arc(px, coinY, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // 内圈亮点
      ctx.fillStyle = '#fff8dc';
      ctx.beginPath();
      ctx.arc(px, coinY, 3, 0, Math.PI * 2);
      ctx.fill();
      
      // 中心符号（$）
      ctx.fillStyle = '#daa520';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('$', px, coinY + 2);
      
      ctx.restore();
    }
    // power-ups
    for (const p of powerUps) {
      if (p.type === 'mushroom') {
        // 蘑菇设计
        const mushroomGradient = ctx.createRadialGradient(p.x, p.y - 2, 0, p.x, p.y - 2, p.r);
        mushroomGradient.addColorStop(0, '#ff6b6b');
        mushroomGradient.addColorStop(1, '#ff3b30');
        
        // 蘑菇帽
        ctx.fillStyle = mushroomGradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 2, p.r, 0, Math.PI);
        ctx.fill();
        
        // 蘑菇斑点
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x - 3, p.y - 4, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x + 2, p.y - 3, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'lifeMushroom') {
        // 加生命蘑菇设计（绿色）
        const lifeMushroomGradient = ctx.createRadialGradient(p.x, p.y - 2, 0, p.x, p.y - 2, p.r);
        lifeMushroomGradient.addColorStop(0, '#81c784');
        lifeMushroomGradient.addColorStop(1, '#4caf50');
        
        // 蘑菇帽
        ctx.fillStyle = lifeMushroomGradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 2, p.r, 0, Math.PI);
        ctx.fill();
        
        // 绿色蘑菇的十字标记（医疗象征）
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x - 1, p.y - 6, 2, 6);
        ctx.fillRect(p.x - 3, p.y - 5, 6, 2);
        
        // 发光效果
        ctx.save();
        ctx.shadowColor = '#4caf50';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#66bb6a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 2, p.r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        
        // 蘑菇茎
        ctx.fillStyle = '#f5f5dc';
        ctx.fillRect(p.x - 2, p.y - 2, 4, p.r);
        
        // 茎部阴影
        ctx.fillStyle = '#e6ddd4';
        ctx.fillRect(p.x + 1, p.y - 2, 1, p.r);
      } else {
        // 其他道具
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); 
        ctx.fill();
      }
    }
  }

    function drawPlayer() {
    const { x, y, w, h } = player;

    // 无敌状态闪烁效果和彩虹光环
    if (invincible) {
      const time = Date.now() * 0.01;
      ctx.save();
      ctx.shadowColor = `hsl(${(time * 10) % 360}, 100%, 50%)`;
      ctx.shadowBlur = 15;
      if (Math.floor(Date.now() / 100) % 2) {
        ctx.globalAlpha = 0.7;
      }
    }

    // 根据大小缩放
    const scale = playerSize;
    const scaledW = w * scale;
    const scaledH = h * scale;
    const offsetX = (scaledW - w) / 2;
    const offsetY = (scaledH - h) / 2;

    // 移动方向和动画
    const isMoving = Math.abs(player.vx) > 10;
    const facingRight = player.vx >= 0;
    const walkCycle = Math.sin(Date.now() * 0.015) * (isMoving ? 1 : 0);

    // 马里奥经典颜色
    const marioRed = '#E60012';
    const marioBlue = '#0066CC';
    const marioBrown = '#8B4513';
    const marioSkin = '#FFDBAC';
    const marioYellow = '#FFCC00';

    // 绘制帽子 (经典红色帽子)
    ctx.fillStyle = marioRed;
    // 帽子主体
    ctx.fillRect(x - offsetX + 2*scale, y - offsetY - 6*scale, 12*scale, 8*scale);
    // 帽檐
    ctx.fillRect(x - offsetX, y - offsetY + 2*scale, 16*scale, 2*scale);
    
    // 帽子上的M标志
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${7*scale}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('M', x - offsetX + 8*scale, y - offsetY + 1*scale);

    // 绘制头发 (棕色)
    ctx.fillStyle = marioBrown;
    ctx.fillRect(x - offsetX + 1*scale, y - offsetY + 4*scale, 3*scale, 2*scale);
    ctx.fillRect(x - offsetX + 12*scale, y - offsetY + 4*scale, 3*scale, 2*scale);

    // 绘制脸部 (肤色)
    ctx.fillStyle = marioSkin;
    ctx.fillRect(x - offsetX + 4*scale, y - offsetY + 4*scale, 8*scale, 6*scale);
    
    // 绘制鼻子 (稍深的肤色)
    ctx.fillStyle = '#E6C2A6';
    ctx.fillRect(x - offsetX + 7*scale, y - offsetY + 6*scale, 2*scale, 2*scale);

    // 绘制眼睛
    ctx.fillStyle = '#000000';
    if (facingRight) {
      // 面向右时的眼睛
      ctx.fillRect(x - offsetX + 6*scale, y - offsetY + 5*scale, 2*scale, 2*scale);
      ctx.fillRect(x - offsetX + 9*scale, y - offsetY + 5*scale, 2*scale, 2*scale);
      // 眼睛高光
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - offsetX + 6*scale, y - offsetY + 5*scale, 1*scale, 1*scale);
      ctx.fillRect(x - offsetX + 9*scale, y - offsetY + 5*scale, 1*scale, 1*scale);
    } else {
      // 面向左时的眼睛
      ctx.fillRect(x - offsetX + 5*scale, y - offsetY + 5*scale, 2*scale, 2*scale);
      ctx.fillRect(x - offsetX + 8*scale, y - offsetY + 5*scale, 2*scale, 2*scale);
      // 眼睛高光
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - offsetX + 6*scale, y - offsetY + 5*scale, 1*scale, 1*scale);
      ctx.fillRect(x - offsetX + 9*scale, y - offsetY + 5*scale, 1*scale, 1*scale);
    }

    // 绘制胡子
    ctx.fillStyle = marioBrown;
    ctx.fillRect(x - offsetX + 4*scale, y - offsetY + 8*scale, 2*scale, 1*scale);
    ctx.fillRect(x - offsetX + 10*scale, y - offsetY + 8*scale, 2*scale, 1*scale);
    ctx.fillRect(x - offsetX + 6*scale, y - offsetY + 9*scale, 4*scale, 1*scale);

    // 绘制上衣 (经典红色)
    ctx.fillStyle = marioRed;
    ctx.fillRect(x - offsetX + 2*scale, y - offsetY + 10*scale, 12*scale, 8*scale);

    // 绘制背带裤 (经典蓝色)
    ctx.fillStyle = marioBlue;
    // 裤子主体
    ctx.fillRect(x - offsetX + 4*scale, y - offsetY + 16*scale, 8*scale, 8*scale);
    // 背带
    ctx.fillRect(x - offsetX + 5*scale, y - offsetY + 10*scale, 2*scale, 8*scale);
    ctx.fillRect(x - offsetX + 9*scale, y - offsetY + 10*scale, 2*scale, 8*scale);

    // 绘制纽扣
    ctx.fillStyle = marioYellow;
    ctx.beginPath();
    ctx.arc(x - offsetX + 6*scale, y - offsetY + 13*scale, 1*scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - offsetX + 10*scale, y - offsetY + 13*scale, 1*scale, 0, Math.PI * 2);
    ctx.fill();

    // 绘制手套 (白色)
    ctx.fillStyle = '#FFFFFF';
    if (isMoving) {
      // 摆动的手臂 - 更自然的动画
      const armSwing = walkCycle * 2;
      if (facingRight) {
        ctx.fillRect(x - offsetX - 1*scale, y - offsetY + 12*scale + armSwing, 3*scale, 4*scale);
        ctx.fillRect(x - offsetX + 14*scale, y - offsetY + 12*scale - armSwing, 3*scale, 4*scale);
      } else {
        ctx.fillRect(x - offsetX - 1*scale, y - offsetY + 12*scale - armSwing, 3*scale, 4*scale);
        ctx.fillRect(x - offsetX + 14*scale, y - offsetY + 12*scale + armSwing, 3*scale, 4*scale);
      }
    } else {
      // 静止的手臂
      ctx.fillRect(x - offsetX + 1*scale, y - offsetY + 13*scale, 2*scale, 4*scale);
      ctx.fillRect(x - offsetX + 13*scale, y - offsetY + 13*scale, 2*scale, 4*scale);
    }

    // 绘制鞋子 (棕色) - 经典马里奥靴子形状
    ctx.fillStyle = marioBrown;
    if (isMoving) {
      // 走路动画的脚 - 交替动画
      const legSwing = walkCycle * 1.5;
      ctx.fillRect(x - offsetX + 3*scale, y - offsetY + 21*scale + legSwing, 5*scale, 4*scale);
      ctx.fillRect(x - offsetX + 8*scale, y - offsetY + 21*scale - legSwing, 5*scale, 4*scale);
      // 鞋子前端
      ctx.fillRect(x - offsetX + 2*scale, y - offsetY + 23*scale + legSwing, 2*scale, 2*scale);
      ctx.fillRect(x - offsetX + 12*scale, y - offsetY + 23*scale - legSwing, 2*scale, 2*scale);
    } else {
      // 静止的脚
      ctx.fillRect(x - offsetX + 3*scale, y - offsetY + 21*scale, 5*scale, 4*scale);
      ctx.fillRect(x - offsetX + 8*scale, y - offsetY + 21*scale, 5*scale, 4*scale);
      // 鞋子前端
      ctx.fillRect(x - offsetX + 2*scale, y - offsetY + 23*scale, 2*scale, 2*scale);
      ctx.fillRect(x - offsetX + 12*scale, y - offsetY + 23*scale, 2*scale, 2*scale);
    }

    if (invincible) {
      ctx.restore();
    }

    ctx.globalAlpha = 1.0;
  }

  function drawEnemies() {
    for (const g of enemies) {
      if (!g.alive) continue;
      
      // 敌人移动方向
      const facingRight = g.vx > 0;
      const time = Date.now() * 0.01;
      
      if (g.spiny) {
        // 带刺敌人：红色身体，黑色刺，更危险的外观
        const spinyGradient = ctx.createRadialGradient(g.x + g.w/2, g.y + g.h/2, 0, g.x + g.w/2, g.y + g.h/2, g.w/2);
        spinyGradient.addColorStop(0, '#ff5722');
        spinyGradient.addColorStop(1, '#d32f2f');
        ctx.fillStyle = spinyGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 危险发光效果
        ctx.save();
        ctx.shadowColor = '#ff1744';
        ctx.shadowBlur = 8;
        
        // 绘制更锋利的刺
        ctx.fillStyle = '#212121';
        // 头顶的刺 - 三角形
        ctx.beginPath();
        ctx.moveTo(g.x + 4, g.y - 2);
        ctx.lineTo(g.x + 6, g.y - 8);
        ctx.lineTo(g.x + 8, g.y - 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(g.x + 10, g.y - 2);
        ctx.lineTo(g.x + 12, g.y - 10);
        ctx.lineTo(g.x + 14, g.y - 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(g.x + 16, g.y - 2);
        ctx.lineTo(g.x + 18, g.y - 8);
        ctx.lineTo(g.x + 20, g.y - 2);
        ctx.fill();
        
        // 身体两侧的刺
        ctx.beginPath();
        ctx.moveTo(g.x - 2, g.y + 6);
        ctx.lineTo(g.x - 6, g.y + 8);
        ctx.lineTo(g.x - 2, g.y + 10);
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(g.x + g.w + 2, g.y + 6);
        ctx.lineTo(g.x + g.w + 6, g.y + 8);
        ctx.lineTo(g.x + g.w + 2, g.y + 10);
        ctx.fill();
        
        ctx.restore();
        
        // 凶恶的红色眼睛，带怒火
        ctx.fillStyle = '#ff1744';
        ctx.fillRect(g.x + 3, g.y + 5, 5, 5);
        ctx.fillRect(g.x + g.w - 8, g.y + 5, 5, 5);
        
        // 眼睛瞳孔
        ctx.fillStyle = '#8b0000';
        ctx.fillRect(g.x + 5, g.y + 7, 1, 1);
        ctx.fillRect(g.x + g.w - 6, g.y + 7, 1, 1);
        
      } else if (g.flying) {
        // 飞行敌人：蓝色身体，动态翅膀
        const flyGradient = ctx.createLinearGradient(g.x, g.y, g.x, g.y + g.h);
        flyGradient.addColorStop(0, '#64b5f6');
        flyGradient.addColorStop(1, '#2196f3');
        ctx.fillStyle = flyGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 动态翅膀动画
        const wingFlap = Math.sin(time * 20) * 3;
        ctx.fillStyle = '#1976d2';
        
        // 左翅膀
        ctx.save();
        ctx.translate(g.x, g.y + 4);
        ctx.rotate(wingFlap * 0.2);
        ctx.fillRect(-6, 0, 6, 8);
        ctx.restore();
        
        // 右翅膀
        ctx.save();
        ctx.translate(g.x + g.w, g.y + 4);
        ctx.rotate(-wingFlap * 0.2);
        ctx.fillRect(0, 0, 6, 8);
        ctx.restore();
        
        // 翅膀细节
        ctx.fillStyle = '#0d47a1';
        ctx.fillRect(g.x - 4, g.y + 3, 2, 6);
        ctx.fillRect(g.x + g.w + 2, g.y + 3, 2, 6);
        
        // 圆润的眼睛
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(g.x + 4, g.y + 6, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 4, g.y + 6, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // 瞳孔
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(g.x + 4, g.y + 6, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 4, g.y + 6, 1, 0, Math.PI * 2);
        ctx.fill();
        
      } else if (g.type === 'tough') {
        // Tough敌人渲染（移除调试信息以提高性能）
        
        // Tough敌人：金属装甲战士，更大尺寸和独特外观
        const isStunned = g.stunTime > 0;
        const hitOnce = g.hits >= 1;
        const time = Date.now() * 0.001;
        
        // 绘制更大的敌人身体
        const bodyScale = 1.2; // 比普通敌人大20%
        const scaledW = g.w * bodyScale;
        const scaledH = g.h * bodyScale;
        const offsetX = (scaledW - g.w) / 2;
        const offsetY = (scaledH - g.h) / 2;
        
        // 根据状态选择颜色
        let bodyColor1, bodyColor2, glowColor;
        if (isStunned) {
          // 眩晕状态：强烈橙色闪烁
          const flash = Math.sin(time * 15) > 0;
          bodyColor1 = flash ? '#ff5722' : '#ff9800';
          bodyColor2 = flash ? '#d84315' : '#f57c00';
          glowColor = '#ff6f00';
        } else if (hitOnce) {
          // 受伤一次：暗红紫色，显示损伤
          bodyColor1 = '#7b1fa2';
          bodyColor2 = '#4a148c';
          glowColor = '#8e24aa';
        } else {
          // 完整状态：深蓝紫色，威武外观
          bodyColor1 = '#3f51b5';
          bodyColor2 = '#1a237e';
          glowColor = '#3949ab';
        }
        
        // 主体发光效果
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = isStunned ? 12 : 6;
        
        // 绘制主体
        const toughGradient = ctx.createRadialGradient(
          g.x - offsetX + scaledW/2, g.y - offsetY + scaledH/2, 0,
          g.x - offsetX + scaledW/2, g.y - offsetY + scaledH/2, scaledW/2
        );
        toughGradient.addColorStop(0, bodyColor1);
        toughGradient.addColorStop(0.7, bodyColor2);
        toughGradient.addColorStop(1, '#000000');
        ctx.fillStyle = toughGradient;
        ctx.fillRect(g.x - offsetX, g.y - offsetY, scaledW, scaledH);
        ctx.restore();
        
        // 装甲板块 - 更详细的设计
        ctx.fillStyle = '#263238';
        // 头盔
        ctx.fillRect(g.x, g.y - 2, g.w, 8);
        // 肩甲
        ctx.fillRect(g.x - 2, g.y + 4, 4, 8);
        ctx.fillRect(g.x + g.w - 2, g.y + 4, 4, 8);
        // 胸甲
        ctx.fillRect(g.x + 2, g.y + 6, g.w - 4, 6);
        // 护腿
        ctx.fillRect(g.x + 1, g.y + 16, g.w - 2, 6);
        
        // 装甲亮点
        ctx.fillStyle = '#455a64';
        ctx.fillRect(g.x + 3, g.y + 1, g.w - 6, 2);
        ctx.fillRect(g.x + 4, g.y + 8, g.w - 8, 2);
        ctx.fillRect(g.x + 2, g.y + 18, g.w - 4, 2);
        
        // 显著的生命值指示器（更大更明显）
        const healthBarWidth = g.w + 4;
        const healthBarHeight = 4;
        const healthBarX = g.x - 2;
        const healthBarY = g.y - 10;
        
        // 血条外框
        ctx.fillStyle = '#000000';
        ctx.fillRect(healthBarX - 1, healthBarY - 1, healthBarWidth + 2, healthBarHeight + 2);
        
        // 血条背景
        ctx.fillStyle = '#424242';
        ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
        
        // 血条前景（分段显示）
        const healthPercent = 1 - (g.hits / g.maxHits);
        const segmentWidth = healthBarWidth / g.maxHits;
        for (let i = 0; i < g.maxHits; i++) {
          if (i < g.maxHits - g.hits) {
            ctx.fillStyle = i === 0 ? '#4caf50' : '#2196f3';
            ctx.fillRect(healthBarX + i * segmentWidth + 1, healthBarY + 1, segmentWidth - 2, healthBarHeight - 2);
          }
        }
        
        // 威武的红色眼睛
        ctx.fillStyle = isStunned ? '#ffeb3b' : '#f44336';
        ctx.shadowColor = isStunned ? '#ffeb3b' : '#f44336';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(g.x + 4, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 4, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // 瞳孔
        if (!isStunned) {
          ctx.fillStyle = '#000000';
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(g.x + 4, g.y + 8, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(g.x + g.w - 4, g.y + 8, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // 强化眩晕特效
        if (isStunned) {
          ctx.save();
          ctx.translate(g.x + g.w/2, g.y - 12);
          ctx.rotate(time * 8);
          ctx.fillStyle = '#ffeb3b';
          ctx.shadowColor = '#ffeb3b';
          ctx.shadowBlur = 8;
          for (let i = 0; i < 8; i++) {
            ctx.save();
            ctx.rotate((Math.PI * 2 / 8) * i);
            ctx.fillRect(-2, -10, 4, 6);
            ctx.restore();
          }
          ctx.restore();
          
          // 额外的震动效果
          const shake = Math.sin(time * 25) * 1;
          ctx.translate(shake, 0);
        }
        
        // 装甲编号标识（使其更容易识别）
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('T', g.x + g.w/2, g.y + 14);
        ctx.restore();
        
      } else if (g.bouncing) {
        // 弹跳敌人：绿色身体，弹性效果
        const bounceGradient = ctx.createRadialGradient(g.x + g.w/2, g.y + g.h/2, 0, g.x + g.w/2, g.y + g.h/2, g.w/2);
        bounceGradient.addColorStop(0, '#81c784');
        bounceGradient.addColorStop(1, '#4caf50');
        ctx.fillStyle = bounceGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 弹簧效果 - 更立体
        ctx.fillStyle = '#2e7d32';
        const springSquash = g.vy > 0 ? 2 : 0; // 下落时压缩弹簧
        
        // 弹簧线圈
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(g.x + 4 + i * 4, g.y - 4 + springSquash, 3, 3 - springSquash);
        }
        
        // 弹簧底座
        ctx.fillStyle = '#1b5e20';
        ctx.fillRect(g.x + 2, g.y - 1, g.w - 4, 2);
        
        // 友善的大眼睛
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(g.x + 6, g.y + 8, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 6, g.y + 8, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // 瞳孔 - 跟随移动方向
        ctx.fillStyle = '#000';
        const eyeOffsetX = facingRight ? 1 : -1;
        ctx.beginPath();
        ctx.arc(g.x + 6 + eyeOffsetX, g.y + 8, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 6 + eyeOffsetX, g.y + 8, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // 眼睛高光
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(g.x + 6 + eyeOffsetX + 1, g.y + 7, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 6 + eyeOffsetX + 1, g.y + 7, 1, 0, Math.PI * 2);
        ctx.fill();
        
      } else if (g.type === 'ghost') {
        // 幽灵敌人：半透明，飘逸效果
        ctx.save();
        ctx.globalAlpha = g.alpha || 0.7;
        
        const ghostGradient = ctx.createRadialGradient(g.x + g.w/2, g.y + g.h/2, 0, g.x + g.w/2, g.y + g.h/2, g.w/2);
        ghostGradient.addColorStop(0, '#e1bee7');
        ghostGradient.addColorStop(1, '#9c27b0');
        ctx.fillStyle = ghostGradient;
        
        // 幽灵身体波浪形
        ctx.beginPath();
        ctx.arc(g.x + g.w/2, g.y + g.h/2, g.w/2, 0, Math.PI * 2);
        ctx.fill();
        
        // 飘逸的尾巴
        const waveOffset = Math.sin(time * 5) * 2;
        ctx.fillStyle = '#ba68c8';
        ctx.beginPath();
        ctx.moveTo(g.x + g.w/2, g.y + g.h);
        ctx.quadraticCurveTo(g.x + g.w/2 + waveOffset, g.y + g.h + 8, g.x + g.w/2 - 4, g.y + g.h + 12);
        ctx.quadraticCurveTo(g.x + g.w/2 - waveOffset, g.y + g.h + 16, g.x + g.w/2 + 4, g.y + g.h + 20);
        ctx.fill();
        
        // 发光效果
        ctx.shadowColor = '#9c27b0';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#e1bee7';
        ctx.beginPath();
        ctx.arc(g.x + g.w/2, g.y + g.h/2, g.w/3, 0, Math.PI * 2);
        ctx.fill();
        
        // 幽灵眼睛
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(g.x + 6, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 6, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(g.x + 6, g.y + 8, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 6, g.y + 8, 1, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
        
      } else if (g.type === 'shooter') {
        // 射击敌人：机械外观
        const shooterGradient = ctx.createLinearGradient(g.x, g.y, g.x, g.y + g.h);
        shooterGradient.addColorStop(0, '#607d8b');
        shooterGradient.addColorStop(1, '#37474f');
        ctx.fillStyle = shooterGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 机械装甲细节
        ctx.fillStyle = '#455a64';
        ctx.fillRect(g.x + 2, g.y + 2, g.w - 4, 2);
        ctx.fillRect(g.x + 2, g.y + g.h - 4, g.w - 4, 2);
        
        // 武器炮管
        ctx.fillStyle = '#263238';
        const cannonLength = 12;
        if (facingRight) {
          ctx.fillRect(g.x + g.w, g.y + g.h/2 - 2, cannonLength, 4);
        } else {
          ctx.fillRect(g.x - cannonLength, g.y + g.h/2 - 2, cannonLength, 4);
        }
        
        // 机械眼睛
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.arc(g.x + g.w/2, g.y + 8, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // 射击指示灯
        if (g.shootTimer > g.shootInterval - 500) {
          ctx.fillStyle = '#ff5722';
          ctx.shadowColor = '#ff5722';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(g.x + g.w/2, g.y + 8, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        
        // 绘制子弹
        if (g.bullets) {
          g.bullets.forEach(bullet => {
            ctx.save();
            
            // 子弹发光效果
            ctx.shadowColor = '#ffeb3b';
            ctx.shadowBlur = 8;
            
            // 子弹主体 - 使用碰撞框大小
            ctx.fillStyle = '#ffeb3b';
            ctx.beginPath();
            ctx.arc(bullet.x + bullet.w/2, bullet.y + bullet.h/2, bullet.w/2, 0, Math.PI * 2);
            ctx.fill();
            
            // 子弹核心
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ff9800';
            ctx.beginPath();
            ctx.arc(bullet.x + bullet.w/2, bullet.y + bullet.h/2, bullet.w/3, 0, Math.PI * 2);
            ctx.fill();
            
            // 子弹轨迹效果
            ctx.fillStyle = '#ffcc02';
            ctx.globalAlpha = 0.6;
            const trailLength = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy) * 0.05;
            const angle = Math.atan2(bullet.vy, bullet.vx);
            ctx.translate(bullet.x + bullet.w/2, bullet.y + bullet.h/2);
            ctx.rotate(angle);
            ctx.fillRect(-trailLength, -1, trailLength, 2);
            
            ctx.restore();
          });
        }
        
      } else if (g.type === 'spiked') {
        // 全身带刺敌人：危险的外观
        ctx.save();
        
        // 发光效果
        const glowIntensity = g.glowIntensity || 0.5;
        ctx.shadowColor = '#ff1744';
        ctx.shadowBlur = 15 * glowIntensity;
        
        const spikedGradient = ctx.createRadialGradient(g.x + g.w/2, g.y + g.h/2, 0, g.x + g.w/2, g.y + g.h/2, g.w/2);
        spikedGradient.addColorStop(0, '#ff5722');
        spikedGradient.addColorStop(1, '#d32f2f');
        ctx.fillStyle = spikedGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 全身尖刺
        ctx.fillStyle = '#212121';
        // 顶部尖刺
        for (let i = 0; i < 5; i++) {
          const spikeX = g.x + 2 + i * 5;
          ctx.beginPath();
          ctx.moveTo(spikeX, g.y);
          ctx.lineTo(spikeX + 2, g.y - 8);
          ctx.lineTo(spikeX + 4, g.y);
          ctx.fill();
        }
        
        // 底部尖刺
        for (let i = 0; i < 5; i++) {
          const spikeX = g.x + 2 + i * 5;
          ctx.beginPath();
          ctx.moveTo(spikeX, g.y + g.h);
          ctx.lineTo(spikeX + 2, g.y + g.h + 8);
          ctx.lineTo(spikeX + 4, g.y + g.h);
          ctx.fill();
        }
        
        // 左侧尖刺
        for (let i = 0; i < 4; i++) {
          const spikeY = g.y + 2 + i * 6;
          ctx.beginPath();
          ctx.moveTo(g.x, spikeY);
          ctx.lineTo(g.x - 8, spikeY + 2);
          ctx.lineTo(g.x, spikeY + 4);
          ctx.fill();
        }
        
        // 右侧尖刺
        for (let i = 0; i < 4; i++) {
          const spikeY = g.y + 2 + i * 6;
          ctx.beginPath();
          ctx.moveTo(g.x + g.w, spikeY);
          ctx.lineTo(g.x + g.w + 8, spikeY + 2);
          ctx.lineTo(g.x + g.w, spikeY + 4);
          ctx.fill();
        }
        
        // 恶魔眼睛
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.arc(g.x + 8, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 8, g.y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(g.x + 8, g.y + 8, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.x + g.w - 8, g.y + 8, 1, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
        
      } else if (g.type === 'jumper') {
        // 跳跃敌人：强壮的外观
        const jumperGradient = ctx.createLinearGradient(g.x, g.y, g.x, g.y + g.h);
        jumperGradient.addColorStop(0, '#4caf50');
        jumperGradient.addColorStop(1, '#2e7d32');
        ctx.fillStyle = jumperGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 强壮的腿部肌肉
        ctx.fillStyle = '#1b5e20';
        ctx.fillRect(g.x + 4, g.y + g.h - 8, 6, 8);
        ctx.fillRect(g.x + g.w - 10, g.y + g.h - 8, 6, 8);
        
        // 跳跃准备指示
        if (g.jumpTimer > g.jumpInterval - 300) {
          ctx.save();
          ctx.fillStyle = '#ffeb3b';
          ctx.shadowColor = '#ffeb3b';
          ctx.shadowBlur = 8;
          // 能量蓄积效果
          const chargeRadius = 2 + (g.jumpTimer - (g.jumpInterval - 300)) / 100;
          ctx.beginPath();
          ctx.arc(g.x + g.w/2, g.y + g.h + 5, chargeRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        
        // 坚毅的眼睛
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(g.x + 6, g.y + 8, 6, 6);
        ctx.fillRect(g.x + g.w - 12, g.y + 8, 6, 6);
        
        ctx.fillStyle = '#000';
        ctx.fillRect(g.x + 8, g.y + 10, 2, 2);
        ctx.fillRect(g.x + g.w - 10, g.y + 10, 2, 2);
        
      } else if (g.type === 'mini') {
        // 迷你敌人：小巧快速
        const miniGradient = ctx.createRadialGradient(g.x + g.w/2, g.y + g.h/2, 0, g.x + g.w/2, g.y + g.h/2, g.w/2);
        miniGradient.addColorStop(0, '#ff9800');
        miniGradient.addColorStop(1, '#f57c00');
        ctx.fillStyle = miniGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 速度线效果
        ctx.fillStyle = '#ffcc02';
        const speedLines = facingRight ? 3 : -3;
        ctx.fillRect(g.x - speedLines, g.y + 2, 2, 1);
        ctx.fillRect(g.x - speedLines * 2, g.y + 4, 3, 1);
        ctx.fillRect(g.x - speedLines, g.y + 6, 2, 1);
        
        // 小眼睛
        ctx.fillStyle = '#fff';
        ctx.fillRect(g.x + 2, g.y + 3, 2, 2);
        ctx.fillRect(g.x + g.w - 4, g.y + 3, 2, 2);
        
        ctx.fillStyle = '#000';
        ctx.fillRect(g.x + 2, g.y + 3, 1, 1);
        ctx.fillRect(g.x + g.w - 4, g.y + 3, 1, 1);

      } else {
        // 普通敌人：棕色身体，更可爱的外观
        const goombaGradient = ctx.createLinearGradient(g.x, g.y, g.x, g.y + g.h);
        goombaGradient.addColorStop(0, '#a1887f');
        goombaGradient.addColorStop(0.5, '#8d6e63');
        goombaGradient.addColorStop(1, '#5d4037');
        ctx.fillStyle = goombaGradient;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        
        // 蘑菇质感
        ctx.fillStyle = '#6d4c41';
        ctx.fillRect(g.x + 2, g.y + 2, g.w - 4, 3);
        
        // 愤怒的眉毛
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(g.x + 3, g.y + 4, 6, 2);
        ctx.fillRect(g.x + g.w - 9, g.y + 4, 6, 2);
        
        // 眼睛
        ctx.fillStyle = '#fff';
        ctx.fillRect(g.x + 4, g.y + 6, 6, 6);
        ctx.fillRect(g.x + g.w - 10, g.y + 6, 6, 6);
        
        // 瞳孔 - 跟随移动方向
        ctx.fillStyle = '#000';
        const eyeOffsetX = facingRight ? 1 : -1;
        ctx.fillRect(g.x + 6 + eyeOffsetX, g.y + 8, 2, 2);
        ctx.fillRect(g.x + g.w - 8 + eyeOffsetX, g.y + 8, 2, 2);
        
        // 小牙齿
        ctx.fillStyle = '#fff';
        ctx.fillRect(g.x + 8, g.y + 14, 2, 3);
        ctx.fillRect(g.x + 12, g.y + 14, 2, 3);
        
        // 脚部
        ctx.fillStyle = '#8d6e63';
        const walkCycle = Math.sin(time + g.x * 0.01) * 1;
        ctx.fillRect(g.x + 2, g.y + g.h + walkCycle, 4, 3);
        ctx.fillRect(g.x + g.w - 6, g.y + g.h - walkCycle, 4, 3);
      }
    }
  }

  function drawUI() {
    ctx.save();
    // HUD background bar
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(12, 12, 420, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(`分数: ${score}  金币: ${coins}  关卡: ${currentLevel + 1}`, 20, 36);
    
    // 显示生命数
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    let livesText = '生命: ';
    for (let i = 0; i < maxLives; i++) {
      livesText += i < lives ? '♥' : '♡';
    }
    ctx.fillText(livesText, 320, 36);
    
    // 显示连击数
    if (combo > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
      ctx.fillText(`连击: ${combo}x`, 20, 58);
    }
    
    // 显示状态效果
    let statusText = '';
    let statusColor = '#00ff00';
    if (invincible) {
      statusText += '无敌 ';
      statusColor = '#22d3ee';
    }
    if (playerSize > 1) {
      statusText += '超级马里奥Lite ';
      statusColor = '#ffa500';
    }
    if (playerSpeed > 1) {
      statusText += '加速 ';
      statusColor = '#ffff00';
    }
    
    if (statusText) {
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
      ctx.fillText(statusText.trim(), 20, 78);
    }
    
    let text = '前进到旗帜！';
    if (player.win) {
      text = '到达旗帜！';
    } else if (!player.alive) {
      if (gameOver) {
        text = '游戏结束！生命耗尽，按 R 重新开始';
      } else {
        text = '你失败了，按 R 重来';
      }
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(text, 20, statusText ? 98 : 58);

    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px system-ui, Segoe UI, Roboto';
      ctx.fillText('暂停', W / 2 - 36, H / 2);
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (!paused) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Setup high-DPI canvas scaling
  function scaleCanvas() {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      // 重新设置上下文缩放
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
  }
  scaleCanvas();
  window.addEventListener('resize', scaleCanvas);
  // 测试画布渲染
  function testRender() {
    console.log('开始测试渲染...');
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.font = '20px Arial';
    ctx.fillText('游戏正在加载...', W/2 - 100, H/2);
    console.log('测试渲染完成');
  }
  
  // 立即测试渲染
  testRender();
  
  // Init level and enemies
  try {
    console.log('开始加载关卡...');
    loadLevel(0);
    console.log('关卡加载完成');
    resetGame(true);
    console.log('游戏重置完成');
  } catch (error) {
    console.error('游戏初始化错误:', error);
  }
  // Touch controls with improved feedback
  function bindTouch(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    
    // 添加触摸反馈
    const addTouchFeedback = () => {
      el.style.transform = 'scale(0.92)';
      el.style.background = 'rgba(52, 211, 153, 0.2)';
      el.style.borderColor = '#22d3ee';
      // 添加触觉反馈
      if (isMobile) {
        if (el.classList.contains('jump')) {
          triggerHaptic('medium');
        } else if (el.classList.contains('pause')) {
          triggerHaptic('light');
        } else {
          triggerHaptic('light');
        }
      }
    };
    
    const removeTouchFeedback = () => {
      el.style.transform = '';
      el.style.background = '';
      el.style.borderColor = '';
    };
    
    const down = (e) => { 
      e.preventDefault(); 
      e.stopPropagation();
      ensureAudio(); 
      addTouchFeedback();
      onDown(); 
      if (musicEnabled) startMusic(); 
    };
    
    const up = (e) => { 
      e.preventDefault(); 
      e.stopPropagation();
      removeTouchFeedback();
      onUp(); 
    };
    
    // 使用更好的事件监听器选项
    const options = { passive: false, capture: true };
    el.addEventListener('touchstart', down, options);
    el.addEventListener('touchend', up, options);
    el.addEventListener('touchcancel', up, options);
    el.addEventListener('pointerdown', down, options);
    el.addEventListener('pointerup', up, options);
    el.addEventListener('pointercancel', up, options);
    
    // 防止长按菜单
    el.addEventListener('contextmenu', (e) => e.preventDefault(), options);
  }
  bindTouch('tc-left', () => keys.left = true, () => keys.left = false);
  bindTouch('tc-right', () => keys.right = true, () => keys.right = false);
  bindTouch('tc-jump', () => {
    keys.up = true;
  }, () => {
    keys.up = false;
    jumpPressed = false;
  });
  bindTouch('tc-pause', () => togglePause(), () => {});

  // 移动端性能优化
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 860;
  
  // 手势操作支持
  let gestureStartX = 0;
  let gestureStartY = 0;
  let gestureStartTime = 0;
  let isGestureActive = false;
  const minSwipeDistance = 50;
  const maxSwipeTime = 300;
  
  // 触觉反馈支持
  let hapticEnabled = true;
  const hapticPatterns = {
    light: [10],
    medium: [20],
    heavy: [30],
    success: [10, 50, 10],
    error: [50, 100, 50],
    jump: [5],
    stomp: [15, 10, 15],
    collect: [5, 5, 5],
    damage: [100, 50, 100]
  };
  
  // 触觉反馈函数
  function triggerHaptic(pattern = 'light') {
    if (!hapticEnabled || !isMobile) return;
    
    try {
      // 支持现代浏览器的触觉反馈API
      if (navigator.vibrate) {
        const vibrationPattern = hapticPatterns[pattern] || hapticPatterns.light;
        navigator.vibrate(vibrationPattern);
      }
      // iOS Safari的触觉反馈（需要用户交互）
      else if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
        // iOS 13+ 触觉反馈需要权限
        const intensity = pattern === 'heavy' ? 1.0 : pattern === 'medium' ? 0.5 : 0.2;
        if (window.navigator.vibrate) {
          window.navigator.vibrate(hapticPatterns[pattern] || hapticPatterns.light);
        }
      }
    } catch (e) {
      console.log('触觉反馈不支持:', e.message);
    }
  }
  
  // 增强的音效播放函数（移动端优化）
  function playMobileOptimizedSfx(sfxFunction, hapticPattern = null) {
    if (audioEnabled) {
      sfxFunction();
    }
    if (hapticPattern && isMobile) {
      triggerHaptic(hapticPattern);
    }
  }
  
  // 手势检测函数
  function initGestureControls() {
    const gameCanvas = document.getElementById('game');
    if (!gameCanvas) return;
    
    // 手势开始
    function handleGestureStart(e) {
      const touch = e.touches ? e.touches[0] : e;
      gestureStartX = touch.clientX;
      gestureStartY = touch.clientY;
      gestureStartTime = Date.now();
      isGestureActive = true;
    }
    
    // 手势结束
    function handleGestureEnd(e) {
      if (!isGestureActive) return;
      
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      const endX = touch.clientX;
      const endY = touch.clientY;
      const endTime = Date.now();
      
      const deltaX = endX - gestureStartX;
      const deltaY = endY - gestureStartY;
      const deltaTime = endTime - gestureStartTime;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      isGestureActive = false;
      
      // 检查是否为有效滑动
      if (distance >= minSwipeDistance && deltaTime <= maxSwipeTime) {
        const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
        
        // 水平滑动
        if (Math.abs(angle) <= 30 || Math.abs(angle) >= 150) {
          if (deltaX > 0) {
            // 右滑 - 向右移动
            keys.right = true;
            setTimeout(() => keys.right = false, 200);
            playMobileOptimizedSfx(() => sfx.buttonClick(), 'light');
          } else {
            // 左滑 - 向左移动
            keys.left = true;
            setTimeout(() => keys.left = false, 200);
            playMobileOptimizedSfx(() => sfx.buttonClick(), 'light');
          }
        }
        // 垂直滑动
        else if (Math.abs(angle - 90) <= 45 || Math.abs(angle + 90) <= 45) {
          if (deltaY < 0) {
            // 上滑 - 跳跃
            if (!keys.up) {
              keys.up = true;
              setTimeout(() => {
                keys.up = false;
                jumpPressed = false;
              }, 150);
              playMobileOptimizedSfx(() => sfx.jump(), 'jump');
            }
          } else {
            // 下滑 - 快速下降（如果在空中）
            if (!player.onGround) {
              player.vy = Math.max(player.vy, 400);
              playMobileOptimizedSfx(() => sfx.buttonClick(), 'medium');
            }
          }
        }
      }
      // 短时间点击 - 跳跃
      else if (distance < minSwipeDistance && deltaTime < 200) {
        if (!keys.up) {
          keys.up = true;
          setTimeout(() => {
            keys.up = false;
            jumpPressed = false;
          }, 150);
          playMobileOptimizedSfx(() => sfx.jump(), 'jump');
        }
      }
    }
    
    // 添加事件监听器
    gameCanvas.addEventListener('touchstart', handleGestureStart, { passive: false });
    gameCanvas.addEventListener('touchend', handleGestureEnd, { passive: false });
    gameCanvas.addEventListener('touchcancel', handleGestureEnd, { passive: false });
    
    // 防止默认滚动行为
    gameCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });
    
    console.log('🎮 手势控制已启用: 滑动操作、点击跳跃');
  }
  
  if (isMobile) {
    // 降低移动端的粒子数量以提升性能
    console.log('📱 检测到移动设备，启用性能优化模式');
    
    // 初始化手势控制
    initGestureControls();
    
    // 添加屏幕方向监听
    function handleOrientationChange() {
      const isLandscape = window.innerWidth > window.innerHeight;
      if (isLandscape) {
        console.log('📐 横屏模式 - 最佳游戏体验');
      } else {
        console.log('📱 竖屏模式 - 建议横屏游戏');
      }
    }
    
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
    handleOrientationChange(); // 初始检查
    
    // 显示移动端游戏提示（首次访问）
    function showMobileTips() {
      const mobileTipsShown = localStorage.getItem('mobileTipsShown');
      if (!mobileTipsShown) {
        const mobileTips = document.getElementById('mobile-tips');
        const closeMobileTips = document.getElementById('close-mobile-tips');
        
        if (mobileTips) {
          mobileTips.style.display = 'flex';
          
          closeMobileTips?.addEventListener('click', () => {
            mobileTips.style.display = 'none';
            localStorage.setItem('mobileTipsShown', 'true');
            triggerHaptic('light');
          });
          
          // 点击背景关闭
          mobileTips.addEventListener('click', (e) => {
            if (e.target === mobileTips) {
              mobileTips.style.display = 'none';
              localStorage.setItem('mobileTipsShown', 'true');
            }
          });
        }
      }
    }
    
    // 延迟显示提示，让用户先看到游戏界面
    setTimeout(showMobileTips, 1500);
    
    // 移动端性能监控
    let frameCount = 0;
    let lastFpsTime = Date.now();
    
    function monitorPerformance() {
      frameCount++;
      const now = Date.now();
      if (now - lastFpsTime >= 5000) { // 每5秒检查一次
        const fps = Math.round(frameCount / 5);
        if (fps < 30) {
          console.log(`⚠️ 性能警告: FPS ${fps}, 建议降低画质或关闭部分效果`);
        } else {
          console.log(`✅ 性能良好: FPS ${fps}`);
        }
        frameCount = 0;
        lastFpsTime = now;
      }
    }
    
    // 在游戏循环中调用性能监控
    const originalUpdate = update;
    update = function(dt) {
      originalUpdate(dt);
      monitorPerformance();
    };
    
    // 禁用某些视觉效果以提升性能
    const style = document.createElement('style');
    style.textContent = `
      canvas#game {
        image-rendering: -webkit-optimize-contrast !important;
        image-rendering: -moz-crisp-edges !important;
        image-rendering: pixelated !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  console.log('启动游戏循环...');
  requestAnimationFrame(frame);
})();


