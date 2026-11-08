// SPDX-License-Identifier: MPL-2.0
// Numeric assignments from Microsoft MS-LCID section 2.2, Language ID table.
// These are identifier facts, including its explicitly named reserved IDs.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-lcid/63d3d639-7fd2-4afb-abbe-0d5b5551eef8
const assignments = `
0001=ar 0002=bg 0003=ca 0004=zh-Hans 0005=cs
0006=da 0007=de 0008=el 0009=en 000a=es
000b=fi 000c=fr 000d=he 000e=hu 000f=is
0010=it 0011=ja 0012=ko 0013=nl 0014=no
0015=pl 0016=pt 0017=rm 0018=ro 0019=ru
001a=hr 001b=sk 001c=sq 001d=sv 001e=th
001f=tr 0020=ur 0021=id 0022=uk 0023=be
0024=sl 0025=et 0026=lv 0027=lt 0028=tg
0029=fa 002a=vi 002b=hy 002c=az 002d=eu
002e=hsb 002f=mk 0030=st 0031=ts 0032=tn
0033=ve 0034=xh 0035=zu 0036=af 0037=ka
0038=fo 0039=hi 003a=mt 003b=se 003c=ga
003d=yi 003e=ms 003f=kk 0040=ky 0041=sw
0042=tk 0043=uz 0044=tt 0045=bn 0046=pa
0047=gu 0048=or 0049=ta 004a=te 004b=kn
004c=ml 004d=as 004e=mr 004f=sa 0050=mn
0051=bo 0052=cy 0053=km 0054=lo 0055=my
0056=gl 0057=kok 0058=mni 0059=sd 005a=syr
005b=si 005c=chr 005d=iu 005e=am 005f=tzm
0060=ks 0061=ne 0062=fy 0063=ps 0064=fil
0065=dv 0066=bin 0067=ff 0068=ha 0069=ibb
006a=yo 006b=quz 006c=nso 006d=ba 006e=lb
006f=kl 0070=ig 0071=kr 0072=om 0073=ti
0074=gn 0075=haw 0076=la 0077=so 0078=ii
0079=pap 007a=arn 007c=moh 007e=br 0080=ug
0081=mi 0082=oc 0083=co 0084=gsw 0085=sah
0086=qut 0087=rw 0088=wo 008c=prs 0091=gd
0092=ku 0093=quc 0401=ar-SA 0402=bg-BG 0403=ca-ES
0404=zh-TW 0405=cs-CZ 0406=da-DK 0407=de-DE 0408=el-GR
0409=en-US 040b=fi-FI 040c=fr-FR 040d=he-IL 040e=hu-HU
040f=is-IS 0410=it-IT 0411=ja-JP 0412=ko-KR 0413=nl-NL
0414=nb-NO 0415=pl-PL 0416=pt-BR 0417=rm-CH 0418=ro-RO
0419=ru-RU 041a=hr-HR 041b=sk-SK 041c=sq-AL 041d=sv-SE
041e=th-TH 041f=tr-TR 0420=ur-PK 0421=id-ID 0422=uk-UA
0423=be-BY 0424=sl-SI 0425=et-EE 0426=lv-LV 0427=lt-LT
0428=tg-Cyrl-TJ 0429=fa-IR 042a=vi-VN 042b=hy-AM 042c=az-Latn-AZ
042d=eu-ES 042e=hsb-DE 042f=mk-MK 0430=st-ZA 0431=ts-ZA
0432=tn-ZA 0433=ve-ZA 0434=xh-ZA 0435=zu-ZA 0436=af-ZA
0437=ka-GE 0438=fo-FO 0439=hi-IN 043a=mt-MT 043b=se-NO
043d=yi-001 043e=ms-MY 043f=kk-KZ 0440=ky-KG 0441=sw-KE
0442=tk-TM 0443=uz-Latn-UZ 0444=tt-RU 0445=bn-IN 0446=pa-IN
0447=gu-IN 0448=or-IN 0449=ta-IN 044a=te-IN 044b=kn-IN
044c=ml-IN 044d=as-IN 044e=mr-IN 044f=sa-IN 0450=mn-MN
0451=bo-CN 0452=cy-GB 0453=km-KH 0454=lo-LA 0455=my-MM
0456=gl-ES 0457=kok-IN 0458=mni-IN 0459=sd-Deva-IN 045a=syr-SY
045b=si-LK 045c=chr-Cher-US 045d=iu-Cans-CA 045e=am-ET 045f=tzm-Arab-MA
0460=ks-Arab 0461=ne-NP 0462=fy-NL 0463=ps-AF 0464=fil-PH
0465=dv-MV 0466=bin-NG 0467=ff-NG 0467=ff-Latn-NG 0468=ha-Latn-NG
0469=ibb-NG 046a=yo-NG 046b=quz-BO 046c=nso-ZA 046d=ba-RU
046e=lb-LU 046f=kl-GL 0470=ig-NG 0471=kr-Latn-NG 0472=om-ET
0473=ti-ET 0474=gn-PY 0475=haw-US 0476=la-VA 0477=so-SO
0478=ii-CN 0479=pap-029 047a=arn-CL 047c=moh-CA 047e=br-FR
0480=ug-CN 0481=mi-NZ 0482=oc-FR 0483=co-FR 0484=gsw-FR
0485=sah-RU 0486=qut-GT 0487=rw-RW 0488=wo-SN 048c=prs-AF
048d=plt-MG 048e=zh-yue-HK 048f=tdd-Tale-CN 0490=khb-Talu-CN 0491=gd-GB
0492=ku-Arab-IQ 0493=quc-CO 0501=qps-ploc 05fe=qps-ploca 0801=ar-IQ
0803=ca-ES-valencia 0804=zh-CN 0807=de-CH 0809=en-GB 080a=es-MX
080c=fr-BE 0810=it-CH 0811=ja-Ploc-JP 0813=nl-BE 0814=nn-NO
0816=pt-PT 0818=ro-MD 0819=ru-MD 081a=sr-Latn-CS 081d=sv-FI
0820=ur-IN 082c=az-Cyrl-AZ 082e=dsb-DE 0832=tn-BW 083b=se-SE
083c=ga-IE 083e=ms-BN 083f=kk-Latn-KZ 0843=uz-Cyrl-UZ 0845=bn-BD
0846=pa-Arab-PK 0849=ta-LK 0850=mn-Mong-CN 0851=bo-BT 0859=sd-Arab-PK
085d=iu-Latn-CA 085f=tzm-Latn-DZ 0860=ks-Deva-IN 0861=ne-IN 0867=ff-Latn-SN
086b=quz-EC 0873=ti-ER 09ff=qps-plocm 0c01=ar-EG 0c04=zh-HK
0c07=de-AT 0c09=en-AU 0c0a=es-ES 0c0c=fr-CA 0c1a=sr-Cyrl-CS
0c3b=se-FI 0c50=mn-Mong-MN 0c51=dz-BT 0c5f=tmz-MA 0c6b=quz-PE
1001=ar-LY 1004=zh-SG 1007=de-LU 1009=en-CA 100a=es-GT
100c=fr-CH 101a=hr-BA 103b=smj-NO 105f=tzm-Tfng-MA 1401=ar-DZ
1404=zh-MO 1407=de-LI 1409=en-NZ 140a=es-CR 140c=fr-LU
141a=bs-Latn-BA 143b=smj-SE 1801=ar-MA 1809=en-IE 180a=es-PA
180c=fr-MC 181a=sr-Latn-BA 183b=sma-NO 1c01=ar-TN 1c09=en-ZA
1c0a=es-DO 1c0c=fr-029 1c1a=sr-Cyrl-BA 1c3b=sma-SE 2001=ar-OM
2009=en-JM 200a=es-VE 200c=fr-RE 201a=bs-Cyrl-BA 203b=sms-FI
2401=ar-YE 2409=en-029 240a=es-CO 240c=fr-CD 241a=sr-Latn-RS
243b=smn-FI 2801=ar-SY 2809=en-BZ 280a=es-PE 280c=fr-SN
281a=sr-Cyrl-RS 2c01=ar-JO 2c09=en-TT 2c0a=es-AR 2c0c=fr-CM
2c1a=sr-Latn-ME 3001=ar-LB 3009=en-ZW 300a=es-EC 300c=fr-CI
301a=sr-Cyrl-ME 3401=ar-KW 3409=en-PH 340a=es-CL 340c=fr-ML
3801=ar-AE 3809=en-ID 380a=es-UY 380c=fr-MA 3c01=ar-BH
3c09=en-HK 3c0a=es-PY 3c0c=fr-HT 4001=ar-QA 4009=en-IN
400a=es-BO 4401=ar-Ploc-SA 4409=en-MY 440a=es-SV 4801=ar-145
4809=en-SG 480a=es-HN 4c09=en-AE 4c0a=es-NI 5009=en-BH
500a=es-PR 5409=en-EG 540a=es-US 5809=en-JO 580a=es-419
5c09=en-KW 5c0a=es-CU 6009=en-TR 6409=en-YE 641a=bs-Cyrl
681a=bs-Latn 6c1a=sr-Cyrl 701a=sr-Latn 703b=smn 742c=az-Cyrl
743b=sms 7804=zh 7814=nn 781a=bs 782c=az-Latn
783b=sma 783f=kk-Cyrl 7843=uz-Cyrl 7850=mn-Cyrl 785d=iu-Cans
785f=tzm-Tfng 7c04=zh-Hant 7c14=nb 7c1a=sr 7c28=tg-Cyrl
7c2e=dsb 7c3b=smj 7c3f=kk-Latn 7c43=uz-Latn 7c46=pa-Arab
7c50=mn-Mong 7c59=sd-Arab 7c5c=chr-Cher 7c5d=iu-Latn 7c5f=tzm-Latn
7c67=ff-Latn 7c68=ha-Latn 7c92=ku-Arab e40c=fr-015
`;

const exact = new Map(),
  specific = new Map();
for (const pair of assignments.trim().split(/\s+/)) {
  const [hex, name] = pair.split('='),
    id = Number.parseInt(hex, 16);
  exact.set(name.toLowerCase(), id);
}
for (const [name, id] of exact) {
  try {
    const locale = new Intl.Locale(name);
    if (!locale.region) continue;
    const key = locale.maximize().baseName.toLowerCase(),
      prior = specific.get(key),
      canonical = locale.baseName.toLowerCase() === name;
    if (!prior || (canonical && !prior.canonical)) specific.set(key, { id, canonical });
  } catch {
    /* Historical Windows names need not be valid browser BCP47 tags. */
  }
}

// Browser preference is an explicit host policy, not a claim to read the OS's
// Windows UI language. No assigned ID means undefined, preserving startup's
// original language/default selection instead of manufacturing LANGID zero.
export function browserWindowsLanguageID(language = globalThis.navigator?.language) {
  if (typeof language !== 'string' || !language) return undefined;
  let locale;
  try {
    locale = new Intl.Locale(language);
  } catch {
    return undefined;
  }
  if (!locale.language || locale.language === 'und' || locale.region === 'ZZ') return undefined;
  if (locale.language === 'no') locale = new Intl.Locale(locale, { language: 'nb' });
  const assigned = specific.get(locale.maximize().baseName.toLowerCase());
  if (assigned) return assigned.id;
  // A specific but unassigned locale must not silently become another region.
  if (locale.region) return undefined;
  return exact.get(locale.baseName.toLowerCase());
}
