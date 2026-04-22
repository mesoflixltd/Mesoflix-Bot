const getSettingsFromLocal = () => {
    const raw_settings = localStorage.getItem('dbot_settings');
    if (!raw_settings) return null;
    return JSON.parse(raw_settings);
};

export const getSetting = (key: string) => {
    const settings = getSettingsFromLocal();
    if (!settings) return null;
    return settings[key];
};

export const storeSetting = (key: string, value: any) => {
    const settings = getSettingsFromLocal() || {};
    settings[key] = value;
    localStorage.setItem('dbot_settings', JSON.stringify(settings));
};

export const removeKeyValue = (key: string) => {
    const settings = getSettingsFromLocal() || {};
    delete settings[key];

    localStorage.setItem('dbot_settings', JSON.stringify(settings));
};
