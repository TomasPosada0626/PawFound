import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import type { AvatarId } from "@/domain/types";

/**
 * Avatares ilustrados de PawFound: mismo dibujo en todos los celulares (los emojis cambiaban según
 * la marca). Cada animalito lleva el collar teal de la marca con su placa dorada de huella, la placa
 * que ayuda a que una mascota vuelva a casa. Generados desde un SVG de 100 × 100.
 */
const ART: Record<AvatarId, () => React.JSX.Element> = {
  // Perrito
  dog: () => (
    <>
      <Defs>
        <RadialGradient id="dog-bg-dog" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFF4E0" />
          <Stop offset="1" stopColor="#FFD9A0" />
        </RadialGradient>
        <LinearGradient id="dog-fur-dog" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F5B567" />
          <Stop offset="1" stopColor="#E0913F" />
        </LinearGradient>
        <ClipPath id="dog-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#dog-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#dog-bg-dog)" />
        <Ellipse cx="22" cy="50" rx="11" ry="20" fill="#B8662A" transform="rotate(18 22 50)" />
        <Ellipse cx="78" cy="50" rx="11" ry="20" fill="#B8662A" transform="rotate(-18 78 50)" />
        <Ellipse cx="50" cy="56" rx="29" ry="27" fill="url(#dog-fur-dog)" />
        <Ellipse cx="50" cy="68" rx="17" ry="13" fill="#FFF1DE" />
        <Ellipse cx="38.5" cy="52" rx="5.2" ry="6" fill="#2B1A12" />
        <Circle cx="40.3" cy="49.6" r="1.9" fill="#fff" />
        <Circle cx="37.4" cy="54" r="0.9" fill="#fff" />
        <Ellipse cx="61.5" cy="52" rx="5.2" ry="6" fill="#2B1A12" />
        <Circle cx="63.3" cy="49.6" r="1.9" fill="#fff" />
        <Circle cx="60.4" cy="54" r="0.9" fill="#fff" />
        <Ellipse cx="30" cy="62" rx="5" ry="3" fill="#FF8FA3" opacity=".45" />
        <Ellipse cx="70" cy="62" rx="5" ry="3" fill="#FF8FA3" opacity=".45" />
        <Ellipse cx="50" cy="63" rx="5" ry="3.6" fill="#2B1A12" />
        <Ellipse cx="48.6" cy="62" rx="1.4" ry=".8" fill="#fff" opacity=".7" />
        <Path d="M44.5 69.5q2.8 3 5.5 0q2.7 3 5.5 0" fill="none" stroke="#2B1A12" strokeWidth="1.6" strokeLinecap="round" />
        <Path d="M47.5 72q2.5 5 5 0z" fill="#FF7A8A" />
        <Path d="M27 78q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 76.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="86.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="85.3" r="0.9" />
          <Circle cx="52" cy="85.3" r="0.9" />
          <Circle cx="46.7" cy="87.1" r="0.8" />
          <Circle cx="53.3" cy="87.1" r="0.8" />
          <Ellipse cx="50" cy="88.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Gatico
  cat: () => (
    <>
      <Defs>
        <RadialGradient id="cat-bg-cat" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#F1ECFF" />
          <Stop offset="1" stopColor="#CFC4FA" />
        </RadialGradient>
        <LinearGradient id="cat-fur-cat" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9AA3B5" />
          <Stop offset="1" stopColor="#77819A" />
        </LinearGradient>
        <ClipPath id="cat-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#cat-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#cat-bg-cat)" />
        <Path d="M24 46L26 18L45 33z" fill="#77819A" />
        <Path d="M28 39L29.5 24L40 33z" fill="#FFB3C3" />
        <Path d="M76 46L74 18L55 33z" fill="#77819A" />
        <Path d="M72 39L70.5 24L60 33z" fill="#FFB3C3" />
        <Ellipse cx="50" cy="56" rx="30" ry="26" fill="url(#cat-fur-cat)" />
        <Path d="M50 31v8M43 32l2 7M57 32l-2 7" stroke="#5E667C" strokeWidth="2.4" strokeLinecap="round" />
        <Ellipse cx="50" cy="67" rx="14" ry="10" fill="#EEF0F6" />
        <Ellipse cx="38" cy="53" rx="5.4" ry="6.2" fill="#3FA66B" />
        <Ellipse cx="38" cy="53.5" rx="2.2" ry="5" fill="#1B2A22" />
        <Circle cx="39.8" cy="50.6" r="1.8" fill="#fff" />
        <Ellipse cx="62" cy="53" rx="5.4" ry="6.2" fill="#3FA66B" />
        <Ellipse cx="62" cy="53.5" rx="2.2" ry="5" fill="#1B2A22" />
        <Circle cx="63.8" cy="50.6" r="1.8" fill="#fff" />
        <Ellipse cx="30" cy="63" rx="4.6" ry="2.8" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="70" cy="63" rx="4.6" ry="2.8" fill="#FF8FA3" opacity=".5" />
        <Path d="M47 62.5h6l-3 3.4z" fill="#FF7A95" />
        <Path d="M45 67q2.5 2.6 5 0q2.5 2.6 5 0" fill="none" stroke="#3B4256" strokeWidth="1.5" strokeLinecap="round" />
        <Path
          d="M33 66l-12-2M33 69l-11 2M67 66l12-2M67 69l11 2"
          stroke="#3B4256"
          strokeWidth="1"
          strokeLinecap="round"
          opacity=".55"
        />
        <Path d="M27 77q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 75.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="85.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="84.3" r="0.9" />
          <Circle cx="52" cy="84.3" r="0.9" />
          <Circle cx="46.7" cy="86.1" r="0.8" />
          <Circle cx="53.3" cy="86.1" r="0.8" />
          <Ellipse cx="50" cy="87.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Zorrito
  fox: () => (
    <>
      <Defs>
        <RadialGradient id="fox-bg-fox" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFF0E8" />
          <Stop offset="1" stopColor="#FFC9AE" />
        </RadialGradient>
        <LinearGradient id="fox-fur-fox" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8A3D" />
          <Stop offset="1" stopColor="#E8641E" />
        </LinearGradient>
        <ClipPath id="fox-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#fox-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#fox-bg-fox)" />
        <Path d="M20 50L22 14L46 34z" fill="#E8641E" />
        <Path d="M25 42L26.5 22L40 34z" fill="#3A2016" />
        <Path d="M80 50L78 14L54 34z" fill="#E8641E" />
        <Path d="M75 42L73.5 22L60 34z" fill="#3A2016" />
        <Path d="M50 30C30 30 20 44 20 54c0 10 12 22 30 26c18-4 30-16 30-26c0-10-10-24-30-24z" fill="url(#fox-fur-fox)" />
        <Path d="M20 54c8 2 16 6 22 14c3 4 5 8 8 12c-18-4-30-16-30-26z" fill="#FFF3EA" />
        <Path d="M80 54c-8 2-16 6-22 14c-3 4-5 8-8 12c18-4 30-16 30-26z" fill="#FFF3EA" />
        <Ellipse cx="38.5" cy="52" rx="4.8" ry="5.6" fill="#2A160D" />
        <Circle cx="40.2" cy="49.8" r="1.7" fill="#fff" />
        <Ellipse cx="61.5" cy="52" rx="4.8" ry="5.6" fill="#2A160D" />
        <Circle cx="63.2" cy="49.8" r="1.7" fill="#fff" />
        <Ellipse cx="32" cy="62" rx="4" ry="2.4" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="68" cy="62" rx="4" ry="2.4" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="50" cy="73" rx="4.4" ry="3.2" fill="#2A160D" />
        <Ellipse cx="48.8" cy="72" rx="1.3" ry=".7" fill="#fff" opacity=".7" />
        <Path d="M27 79q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 77.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="87.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="86.3" r="0.9" />
          <Circle cx="52" cy="86.3" r="0.9" />
          <Circle cx="46.7" cy="88.1" r="0.8" />
          <Circle cx="53.3" cy="88.1" r="0.8" />
          <Ellipse cx="50" cy="89.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Panda
  panda: () => (
    <>
      <Defs>
        <RadialGradient id="panda-bg-panda" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#E9FBF6" />
          <Stop offset="1" stopColor="#B9EBDD" />
        </RadialGradient>
        <ClipPath id="panda-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#panda-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#panda-bg-panda)" />
        <Circle cx="25" cy="30" r="11" fill="#22252B" />
        <Circle cx="75" cy="30" r="11" fill="#22252B" />
        <Ellipse cx="50" cy="55" rx="31" ry="28" fill="#FFFFFF" />
        <Ellipse cx="38" cy="52" rx="8" ry="10" fill="#22252B" transform="rotate(-25 38 52)" />
        <Ellipse cx="62" cy="52" rx="8" ry="10" fill="#22252B" transform="rotate(25 62 52)" />
        <Circle cx="39" cy="51" r="3.6" fill="#fff" />
        <Circle cx="39.6" cy="51.4" r="2.3" fill="#22252B" />
        <Circle cx="40.4" cy="50.4" r=".9" fill="#fff" />
        <Circle cx="61" cy="51" r="3.6" fill="#fff" />
        <Circle cx="60.4" cy="51.4" r="2.3" fill="#22252B" />
        <Circle cx="61.2" cy="50.4" r=".9" fill="#fff" />
        <Ellipse cx="29" cy="65" rx="5" ry="3" fill="#FF9FB2" opacity=".55" />
        <Ellipse cx="71" cy="65" rx="5" ry="3" fill="#FF9FB2" opacity=".55" />
        <Ellipse cx="50" cy="64" rx="4.6" ry="3.2" fill="#22252B" />
        <Path d="M45 69q2.5 2.8 5 0q2.5 2.8 5 0" fill="none" stroke="#22252B" strokeWidth="1.6" strokeLinecap="round" />
        <Path d="M27 78q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 76.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="86.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="85.3" r="0.9" />
          <Circle cx="52" cy="85.3" r="0.9" />
          <Circle cx="46.7" cy="87.1" r="0.8" />
          <Circle cx="53.3" cy="87.1" r="0.8" />
          <Ellipse cx="50" cy="88.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Conejito
  bunny: () => (
    <>
      <Defs>
        <RadialGradient id="bunny-bg-bunny" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFF0F6" />
          <Stop offset="1" stopColor="#FCC8DD" />
        </RadialGradient>
        <ClipPath id="bunny-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#bunny-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#bunny-bg-bunny)" />
        <Ellipse cx="37" cy="24" rx="8.5" ry="21" fill="#FFFFFF" transform="rotate(-10 37 24)" />
        <Ellipse cx="37" cy="25" rx="4.2" ry="15" fill="#FFB3CB" transform="rotate(-10 37 25)" />
        <Ellipse cx="63" cy="24" rx="8.5" ry="21" fill="#FFFFFF" transform="rotate(10 63 24)" />
        <Ellipse cx="63" cy="25" rx="4.2" ry="15" fill="#FFB3CB" transform="rotate(10 63 25)" />
        <Ellipse cx="50" cy="60" rx="28" ry="25" fill="#FFFFFF" />
        <Ellipse cx="39" cy="57" rx="4.8" ry="5.6" fill="#3A2730" />
        <Circle cx="40.7" cy="54.8" r="1.7" fill="#fff" />
        <Ellipse cx="61" cy="57" rx="4.8" ry="5.6" fill="#3A2730" />
        <Circle cx="62.7" cy="54.8" r="1.7" fill="#fff" />
        <Ellipse cx="31" cy="66" rx="5" ry="3" fill="#FF8FB1" opacity=".55" />
        <Ellipse cx="69" cy="66" rx="5" ry="3" fill="#FF8FB1" opacity=".55" />
        <Path d="M47 65h6l-3 3z" fill="#FF7FA6" />
        <Path
          d="M50 68v3M45.5 71q2.2 2.4 4.5 0q2.3 2.4 4.5 0"
          fill="none"
          stroke="#3A2730"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <Rect x="47" y="73" width="6" height="5" rx="1.2" fill="#fff" stroke="#E7D7DE" strokeWidth=".8" />
        <Path d="M27 80q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 78.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="88.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="87.3" r="0.9" />
          <Circle cx="52" cy="87.3" r="0.9" />
          <Circle cx="46.7" cy="89.1" r="0.8" />
          <Circle cx="53.3" cy="89.1" r="0.8" />
          <Ellipse cx="50" cy="90.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Osito
  bear: () => (
    <>
      <Defs>
        <RadialGradient id="bear-bg-bear" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#EEF4FF" />
          <Stop offset="1" stopColor="#C9DAF6" />
        </RadialGradient>
        <LinearGradient id="bear-fur-bear" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#B07A52" />
          <Stop offset="1" stopColor="#8E5C38" />
        </LinearGradient>
        <ClipPath id="bear-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#bear-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#bear-bg-bear)" />
        <Circle cx="26" cy="31" r="11" fill="#8E5C38" />
        <Circle cx="26" cy="31" r="5.5" fill="#E7B98F" />
        <Circle cx="74" cy="31" r="11" fill="#8E5C38" />
        <Circle cx="74" cy="31" r="5.5" fill="#E7B98F" />
        <Ellipse cx="50" cy="55" rx="31" ry="28" fill="url(#bear-fur-bear)" />
        <Ellipse cx="50" cy="66" rx="15" ry="12" fill="#E7B98F" />
        <Ellipse cx="38" cy="51" rx="4.6" ry="5.4" fill="#2A1B12" />
        <Circle cx="39.6" cy="49" r="1.6" fill="#fff" />
        <Ellipse cx="62" cy="51" rx="4.6" ry="5.4" fill="#2A1B12" />
        <Circle cx="63.6" cy="49" r="1.6" fill="#fff" />
        <Ellipse cx="29" cy="61" rx="4.6" ry="2.8" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="71" cy="61" rx="4.6" ry="2.8" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="50" cy="61" rx="5" ry="3.6" fill="#2A1B12" />
        <Ellipse cx="48.6" cy="60" rx="1.4" ry=".8" fill="#fff" opacity=".7" />
        <Path d="M44.5 67q2.8 3 5.5 0q2.7 3 5.5 0" fill="none" stroke="#2A1B12" strokeWidth="1.6" strokeLinecap="round" />
        <Path d="M27 78q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 76.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="86.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="85.3" r="0.9" />
          <Circle cx="52" cy="85.3" r="0.9" />
          <Circle cx="46.7" cy="87.1" r="0.8" />
          <Circle cx="53.3" cy="87.1" r="0.8" />
          <Ellipse cx="50" cy="88.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Pug
  pug: () => (
    <>
      <Defs>
        <RadialGradient id="pug-bg-pug" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFF8E6" />
          <Stop offset="1" stopColor="#FBE2A8" />
        </RadialGradient>
        <LinearGradient id="pug-fur-pug" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F0D3A6" />
          <Stop offset="1" stopColor="#DDB57E" />
        </LinearGradient>
        <ClipPath id="pug-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#pug-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#pug-bg-pug)" />
        <Path d="M19 38c4-10 14-12 18-8c-3 8-9 14-16 16c-3-2-3-5-2-8z" fill="#3B2E28" />
        <Path d="M81 38c-4-10-14-12-18-8c3 8 9 14 16 16c3-2 3-5 2-8z" fill="#3B2E28" />
        <Ellipse cx="50" cy="56" rx="31" ry="28" fill="url(#pug-fur-pug)" />
        <Path d="M42 36q8-4 16 0M44 41q6-3 12 0" fill="none" stroke="#C49A63" strokeWidth="1.6" strokeLinecap="round" />
        <Ellipse cx="50" cy="68" rx="18" ry="14" fill="#4A3A33" />
        <Ellipse cx="36" cy="52" rx="6.4" ry="6.8" fill="#2A1E19" />
        <Circle cx="38.4" cy="49.6" r="2.2" fill="#fff" />
        <Circle cx="34.6" cy="54.4" r="1" fill="#fff" />
        <Ellipse cx="64" cy="52" rx="6.4" ry="6.8" fill="#2A1E19" />
        <Circle cx="66.4" cy="49.6" r="2.2" fill="#fff" />
        <Circle cx="62.6" cy="54.4" r="1" fill="#fff" />
        <Ellipse cx="50" cy="62" rx="5.4" ry="3.6" fill="#1A1210" />
        <Ellipse cx="48.6" cy="61" rx="1.5" ry=".8" fill="#fff" opacity=".6" />
        <Path d="M43.5 69q3.2 3.2 6.5 0q3.3 3.2 6.5 0" fill="none" stroke="#1A1210" strokeWidth="1.6" strokeLinecap="round" />
        <Path d="M47.5 71q2.5 6 5 0z" fill="#FF7A8A" />
        <Path d="M27 79q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 77.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="87.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="86.3" r="0.9" />
          <Circle cx="52" cy="86.3" r="0.9" />
          <Circle cx="46.7" cy="88.1" r="0.8" />
          <Circle cx="53.3" cy="88.1" r="0.8" />
          <Ellipse cx="50" cy="89.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
  // Hámster
  hamster: () => (
    <>
      <Defs>
        <RadialGradient id="hamster-bg-ham" cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFF3E2" />
          <Stop offset="1" stopColor="#FFD7B5" />
        </RadialGradient>
        <LinearGradient id="hamster-fur-ham" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F7B26B" />
          <Stop offset="1" stopColor="#E8924A" />
        </LinearGradient>
        <ClipPath id="hamster-clip">
          <Circle cx="50" cy="50" r="50" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#hamster-clip)">
        <Circle cx="50" cy="50" r="50" fill="url(#hamster-bg-ham)" />
        <Circle cx="27" cy="33" r="9" fill="#E8924A" />
        <Circle cx="27" cy="33" r="5" fill="#FFB8C2" />
        <Circle cx="73" cy="33" r="9" fill="#E8924A" />
        <Circle cx="73" cy="33" r="5" fill="#FFB8C2" />
        <Path d="M50 30c-20 0-32 14-32 30c0 13 13 22 32 22s32-9 32-22c0-16-12-30-32-30z" fill="url(#hamster-fur-ham)" />
        <Path
          d="M50 46c-8 0-13 6-13 10c0 4 4 6 4 6c-7 1-14 5-14 12c5 6 13 8 23 8s18-2 23-8c0-7-7-11-14-12c0 0 4-2 4-6c0-4-5-10-13-10z"
          fill="#FFF6EC"
        />
        <Ellipse cx="38" cy="50" rx="4.6" ry="5.2" fill="#2E1E14" />
        <Circle cx="39.6" cy="48" r="1.6" fill="#fff" />
        <Ellipse cx="62" cy="50" rx="4.6" ry="5.2" fill="#2E1E14" />
        <Circle cx="63.6" cy="48" r="1.6" fill="#fff" />
        <Ellipse cx="30" cy="62" rx="6" ry="4" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="70" cy="62" rx="6" ry="4" fill="#FF8FA3" opacity=".5" />
        <Ellipse cx="50" cy="58" rx="3" ry="2.2" fill="#FF7A8A" />
        <Path d="M46 62q2 2.4 4 0q2 2.4 4 0" fill="none" stroke="#2E1E14" strokeWidth="1.4" strokeLinecap="round" />
        <Rect x="47.4" y="63.5" width="2.4" height="3.2" rx=".6" fill="#fff" stroke="#E2D2C4" strokeWidth=".5" />
        <Rect x="50.2" y="63.5" width="2.4" height="3.2" rx=".6" fill="#fff" stroke="#E2D2C4" strokeWidth=".5" />
        <Path d="M27 80q23 13 46 0" fill="none" stroke="#0E9C8F" strokeWidth="5.5" strokeLinecap="round" />
        <Path d="M27 78.7q23 13 46 0" fill="none" stroke="#5FE0CF" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        <Circle cx="50" cy="88.5" r="5.6" fill="#F6C453" stroke="#D99A16" strokeWidth="1" />
        <G fill="#B7790E">
          <Circle cx="48" cy="87.3" r="0.9" />
          <Circle cx="52" cy="87.3" r="0.9" />
          <Circle cx="46.7" cy="89.1" r="0.8" />
          <Circle cx="53.3" cy="89.1" r="0.8" />
          <Ellipse cx="50" cy="90.4" rx="1.9" ry="1.5" />
        </G>
      </G>
    </>
  ),
};

export const AVATAR_IDS = Object.keys(ART) as AvatarId[];

export function AvatarArt({ avatar, size = 56 }: { avatar: AvatarId; size?: number }) {
  const Art = ART[avatar] ?? ART.dog;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Art />
    </Svg>
  );
}
