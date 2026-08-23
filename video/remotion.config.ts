/**
 * Настройки сборки видео.
 *
 * Кодек h264 и умеренное качество: файл поедет по сети из демки,
 * и стомегабайтный ролик там не нужен.
 */
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setCrf(23);
