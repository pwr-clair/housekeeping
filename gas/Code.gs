// ============================================================
// Paradise Walk — 자동화 서버 v5 (통합본)
// 포함: SIRVOY webhook / 6단계 메일 / 자동전환 / 수동발송(sendStage)
// [버전관리] 2026-07-14부터 이 파일이 정본(housekeeping 레포 /gas/Code.gs).
//   GAS 에디터(PWR-HK-Engine)에 전문 붙여넣기로 반영.
// [패치 2026-07-14] previewStage/sendStageEdited가 custom_* 단계(발송탭 [안내]
//   커스텀 템플릿, app/mailTemplates/custom_{ts})를 허용.
// ============================================================

// 지금 GAS 에디터에 붙어 있는 코드가 어느 버전인지 확인하는 도장. 커밋할 때마다 갱신한다.
// 에디터에서 codeVersion 실행 → 로그에 찍힌다. 웹훅(doPost) 반영 여부는 재배포까지 해야 바뀐다.
// ★ 붙여넣기·재배포를 했는지 눈으로 확인할 수단이 없어서 매번 추측했다 (2026-09-21 신설).
var CODE_VER = '2026-09-21b dumpUpcoming 추가';
function codeVersion(){
  var dep='(웹앱 미배포)';
  try{ dep=ScriptApp.getService().getUrl()||dep; }catch(e){}
  var out='■ 에디터 코드 버전: '+CODE_VER+'\n■ 웹앱 URL: '+dep+
          '\n※ 이 값은 저장된 코드 기준. 웹훅(doPost)까지 반영하려면 [배포 관리]에서 새 버전 배포 필요.';
  Logger.log(out); return out;
}

const FB = 'https://paradise-walk-residence-default-rtdb.asia-southeast1.firebasedatabase.app';
const FB_AUTH = PropertiesService.getScriptProperties().getProperty('FB_AUTH');
const SENDER = 'paradisewalkresidence@gmail.com';
const ADMIN_EMAIL = 'joi.hurricane@gmail.com';
const APPROVE_TOKEN = PropertiesService.getScriptProperties().getProperty('APPROVE_TOKEN');
function roomNums(){
  var rooms = fbGet('app/rooms') || {};
  return Object.keys(rooms).sort(function(a,b){ return (+a) - (+b); });
}

// ─── Firebase REST ───────────────────────────────────────────
function fbGet(p){const r=UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{muteHttpExceptions:true});return JSON.parse(r.getContentText());}
function fbSet(p,d){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'put',contentType:'application/json',payload:JSON.stringify(d),muteHttpExceptions:true});}
function fbUpdate(p,d){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'patch',contentType:'application/json',payload:JSON.stringify(d),muteHttpExceptions:true});}
function fbDelete(p){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'delete',muteHttpExceptions:true});}

// ─── 유틸 ────────────────────────────────────────────────────
function kstDate(o){return Utilities.formatDate(new Date(Date.now()+(o||0)*864e5),'Asia/Seoul','yyyy-MM-dd');}
function todayKST(){return kstDate(0);}
function nowHM(){return Utilities.formatDate(new Date(),'Asia/Seoul','HH:mm');}
function nowMinKST(){return +Utilities.formatDate(new Date(),'Asia/Seoul','H')*60 + +Utilities.formatDate(new Date(),'Asia/Seoul','m');}
function floorOf(room){return String(room).length===3?String(room)[0]:String(room).slice(0,2);}
function normSource(s){s=String(s||'').toLowerCase();if(s.includes('booking'))return 'booking';if(s.includes('agoda'))return 'agoda';if(s.includes('expedia'))return 'expedia';return 'direct';}

// ─── ETA → rooms.checkinTime 동기화 ───
function etaStart(eta){
  if(!eta) return '';
  var em = String(eta).match(/^(\d{1,2}):(\d{2})/);
  if(!em) return '';
  return String(em[1]).padStart(2,'0') + ':' + em[2];
}
// force=true(웹훅에서 ETA가 실제로 바뀐 경우)만 기존 checkinTime을 덮어쓴다.
// force 없으면 빈칸 채움만 — 수기 입력·CS 승인 반영이 15분 트리거·웹훅 재푸시에 되돌아가던 사고 방지 (2026-07-15 클라라: 최신 입력 최우선).
function syncEtaToRoom(bookingId, eta, force){
  if(!bookingId) return;
  var ci = etaStart(eta);
  if(!ci) return;
  var rooms = fbGet('app/rooms') || {};
  Object.keys(rooms).forEach(function(rm){
    var r = rooms[rm]; if(!r) return;
    var changed = false;
    if(r.currentBooking && String(r.currentBooking.bookingId) === String(bookingId)){
      if((force||!r.currentBooking.checkinTime) && r.currentBooking.checkinTime !== ci){ r.currentBooking.checkinTime = ci; changed = true; }
    }
    if(Array.isArray(r.nextBookings)){
      r.nextBookings.forEach(function(b){
        if(b && String(b.bookingId) === String(bookingId) && (force||!b.checkinTime) && b.checkinTime !== ci){
          b.checkinTime = ci; changed = true;
        }
      });
    }
    if(changed) fbSet('app/rooms/'+rm, r);
  });
}
function syncAllEtaToRooms(){  // 15분 트리거 — 빈칸 채움만(force 없음)
  var pend = fbGet('app/pendingBookings') || {};
  var count = 0;
  Object.keys(pend).forEach(function(k){
    var p = pend[k];
    if(p && p.eta && p.bookingId && !p.cancelled){
      syncEtaToRoom(p.bookingId, p.eta);
      count++;
    }
  });
  Logger.log('syncAllEtaToRooms: processed '+count+' pending entries');
  return count;
}

// pendingBookings에 이메일이 없을 때 방 예약(같은 bookingId)의 이메일로 보강 (2026-08-23) —
// 수기 입력 이메일이 방 데이터에만 있던 직거래 예약도 발송되게 하는 안전망.
function roomEmailFor_(bk,room){
  if(!room||!bk||!bk.bookingId)return '';
  var r=fbGet('app/rooms/'+room);if(!r)return '';
  var cands=[r.currentBooking].concat(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{}));
  for(var i=0;i<cands.length;i++){
    var b=cands[i];
    if(b&&String(b.bookingId||'')===String(bk.bookingId)&&b.guestEmail)return b.guestEmail;
  }
  return '';
}

function sendMail(to, subject, body){
  var opts = { from: SENDER };
  var bcc = fbGet('app/config/bccEmail');
  if(bcc) opts.bcc = bcc;
  GmailApp.sendEmail(to, subject, body, opts);
}
// 특이사항(notes) 속 추가 이메일을 수신자에 합류 (2026-09-06 클라라).
// 동행 게스트 등 두 번째 이메일을 대시보드 특이사항에 적어두면 모든 게스트 발송이 그 주소에도 함께 나간다.
// 반환: guestEmail + notes에서 찾은 이메일들(중복 제거)의 콤마 결합 문자열.
// 2026-09-18 클라라: 이메일 칸이 비어도 특이사항에 주소가 있으면 그리로 발송 — 모든 '이메일 없음' 가드가 이 함수를 본다.
function guestRecipients_(bk){
  var main=String((bk&&bk.guestEmail)||'').trim();
  var list=[],seen={};
  var add=function(e){e=String(e||'').trim();if(!e)return;var k=e.toLowerCase();if(seen[k])return;seen[k]=1;list.push(e);};
  main.split(/[,;\s]+/).forEach(add);
  (String((bk&&bk.notes)||'').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)||[]).forEach(add);
  return list.join(',');
}
function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// ============================================================
// SIRVOY Webhook 수신
// ============================================================
function doPost(e){
  try{
    const b=JSON.parse(e.postData.contents);
    const id='sv_'+b.bookingId;
    const pend=fbGet('app/pendingBookings')||{};
    const chId=String(b.channelBookingId||'');
    const gName=((b.guest&&b.guest.lastName)||'')+', '+((b.guest&&b.guest.firstName)||'');
    let foundKey=null;
    const inBkId=String(b.bookingId||'');
    for(const [k,v] of Object.entries(pend)){
      if(!v)continue;
      if(inBkId&&String(v.bookingId||'').indexOf('_')<0&&String(v.bookingId||'')===inBkId){foundKey=k;break;}
      if(chId&&String(v.channelBookingId||'')===chId){foundKey=k;break;}
      if(!chId&&v.guest===gName&&v.checkinDate===(b.arrivalDate||'')&&v.checkoutDate===(b.departureDate||'')){foundKey=k;break;}
    }
    const targetKey=foundKey||id;
    const prev=pend[targetKey]||{};

    if(b.event==='cancelled'||b.cancelled===true){
      fbUpdate('app/pendingBookings/'+targetKey,{cancelled:true});
      return ContentService.createTextOutput('OK');
    }

    const raw=((b.guest&&b.guest.message)||'')+' ; '+(b.internalComment||'');
    let eta=b.eta||'';
    let m=raw.match(/arrival\s*time\s*:?\s*(\d{1,2})[\s:h.]*(\d{2})?\s*(?:-\s*(\d{1,2})[\s:h.]*(\d{2})?)?/i);
    if(!m)m=raw.match(/time of arrival\s*:?\s*(?:between\s*)?(\d{1,2})[\s:h.]*(\d{2})?\s*(?:and|-)\s*(\d{1,2})[\s:h.]*(\d{2})?/i);
    if(!eta&&m){
      eta=m[1]+':'+(m[2]||'00');
      if(m[3])eta+='-'+m[3]+':'+(m[4]||'00');
    }
        const notes=raw
        .replace(/approximate time of arrival\s*:?[^;\n]*/ig,'')
        .replace(/time of arrival\s*:?[^;\n]*/ig,'')
        .replace(/arrival\s*time\s*:?[^;\n]*/ig,'')
        .replace(/benefits?\s*:[^;\n]*;?/ig,'')
        .replace(/channel\s*name\s*:[^;\n]*;?/ig,'')
        .replace(/this booking includes[^.;\n]*[.;]?/ig,'')
        .replace(/etp\s*:[^;\n]*;?/ig,'')
        .replace(/remittance amount\s*:?[^;\n]*/ig,'')
        .replace(/brand\s*:?\s*[^;\n]*/ig,'')
        .replace(/hotel collect\s*booking collect\s*payment from guest\.*/ig,'')
        .replace(/(agoda|expedia)\s*collect\.?/ig,'')
        .replace(/\*+\s*this reservation has been pre-?paid\s*\*+/ig,'')
        .replace(/reservation has a cancellation grace period\.?[^.]*\d{4}-\d{2}-\d{2}[\s\d:]*\.?/ig,'')
        .replace(/booking note\s*:?\s*payment charge is[^;\n]*/ig,'')
        .replace(/booker is genius\.?/ig,'')
        .replace(/^\s*\d*\s*(?:queen|king|double|twin|single)\s*bed\s*$/gim,'')
        .replace(/^\s*non[-\s]?smoking\s*$/gim,'')
        .replace(/the phone number[\s\S]*?phone number"?\s*field\.?/ig,'')
        .replace(/(?:special\s*)?requests?\s*:\s*/ig,'')
        .replace(/\(the next day\)/ig,'')
        .replace(/[;,]\s*$/g,'')
        .replace(/^[\s;,.\-]+|[\s;,.\-]+$/g,'')
        .replace(/\s{2,}/g,' ').trim();

    // ETA 최신 우선 (2026-07-15 클라라): 웹훅이 마지막으로 준 값(etaWebhook)과 같으면 재푸시일 뿐 —
    // 그 사이 수기·CS 승인으로 바뀐 eta를 덮지 않는다. 웹훅 값이 실제로 바뀐 경우만 최신으로 반영(force).
    var __rooms = (b && Array.isArray(b.rooms)) ? b.rooms : [];
    if (__rooms.length >= 2) {
      // 방별 카드 키는 언제나 정본 id('sv_'+bookingId) 기준. targetKey(=foundKey)를 쓰면
      // 재푸시 때 foundKey가 이미 만들어진 방별 카드(sv_123_501)로 잡혀 sv_123_501_501 같은
      // 새 키가 생기고, 예약 한 건이 방 수만큼 통째로 복제된다(배정탭 미배정에 쌍둥이 카드).
      // 정본 id로 고정하면 재푸시가 같은 키를 덮어써 멱등. (2026-09-20 클라라 신고)
      var __mbase = id;
      var __wrote = 0;
      __rooms.forEach(function(__rm){
        var __rn = String((__rm && __rm.RoomName) || '').trim();
        if (!__rn) return;
        __wrote++;
        var __mkey = __mbase + '_' + __rn;
        var __mprev = (pend && pend[__mkey]) || {};
        var __etaNew = !!eta && eta !== (__mprev.etaWebhook||'');
        fbSet('app/pendingBookings/'+__mkey, {
          bookingId:__mprev.bookingId||(String(b.bookingId)+'_'+__rn),
          channelBookingId:chId||__mprev.channelBookingId||'',
          source:b.bookingSource||__mprev.source||'',
          guest:gName,
          guestEmail:(b.guest&&b.guest.email)||__mprev.guestEmail||'',
          guestPhone:__mprev.phoneManual?(__mprev.guestPhone||''):((b.guest&&b.guest.phone)||__mprev.guestPhone||''),  // 수동 입력 번호(phoneManual)는 웹훅 중계번호로 덮지 않음 (최신 입력 최우선)
          phoneManual:__mprev.phoneManual||null,
          checkinDate:(__rm.arrivalDate||b.arrivalDate||''),checkoutDate:(__rm.departureDate||b.departureDate||''),
          eta:__etaNew?eta:(__mprev.eta||''),etaWebhook:eta,notes:notes,
          amount:(__mprev.amount!=null&&__mprev.amount!==''?__mprev.amount:null),  // 재푸시에 금액(메일 동기화·수기) 보존 — null은 RTDB에서 필드 생략
          cancelled:false,
          assignedRoom:__mprev.assignedRoom||null,
          receivedAt:__mprev.receivedAt||(todayKST()+' '+nowHM())
        });
        if(__etaNew) syncEtaToRoom(__mprev.bookingId || String(b.bookingId), eta, true);
      });
      // 수정=replace(§5): 1방→멀티룸으로 바뀐 예약은 구 단일 카드를 삭제 (방별 카드로 대체됨).
      // 단일 레코드 판별 = bookingId에 '_' 없음(위 매칭 로직과 동일 규약). 방별 기록 실패 시엔 보존.
      var __old = pend[targetKey];
      if (__wrote >= 2 && __old && String(__old.bookingId||'').indexOf('_') < 0) fbDelete('app/pendingBookings/'+targetKey);
    } else {
      var __etaNew1 = !!eta && eta !== (prev.etaWebhook||'');
      fbSet('app/pendingBookings/'+targetKey,{
      bookingId:prev.bookingId||String(b.bookingId),
      channelBookingId:chId||prev.channelBookingId||'',
      source:b.bookingSource||prev.source||'',
      guest:gName,
      guestEmail:(b.guest&&b.guest.email)||prev.guestEmail||'',
      guestPhone:prev.phoneManual?(prev.guestPhone||''):((b.guest&&b.guest.phone)||prev.guestPhone||''),  // 수동 입력 번호(phoneManual)는 웹훅 중계번호로 덮지 않음
      phoneManual:prev.phoneManual||null,
      checkinDate:b.arrivalDate||'',checkoutDate:b.departureDate||'',
      eta:__etaNew1?eta:(prev.eta||''),etaWebhook:eta,notes:notes,
      amount:(prev.amount!=null&&prev.amount!==''?prev.amount:null),  // 재푸시에 금액 보존
      cancelled:false,
      assignedRoom:prev.assignedRoom||null,
      receivedAt:prev.receivedAt||(todayKST()+' '+nowHM())
    });
    if(__etaNew1) syncEtaToRoom(prev.bookingId || String(b.bookingId), eta, true);
    }
  }catch(err){}
  return ContentService.createTextOutput('OK');
}

// ============================================================
// 발송 공통
// ============================================================
function sendStageMail(stage,bk,room,force,tplKey){
    var __nights = (bk && bk.checkinDate && bk.checkoutDate)
      ? Math.round((new Date(bk.checkoutDate) - new Date(bk.checkinDate)) / 86400000)
      : null;
    if(__nights === 1){
      if(stage === 's3_checkin') stage = 's34_combined';
      else if(stage === 's4_checkout') return false;
    }
  if(!guestRecipients_(bk))return false;
  if(!force){
    const cfg=fbGet('app/mailConfig')||{};
    const gateStage=(stage==='s34_combined')?'s3_checkin':stage;   // s34_combined = 입실안내 1박변형 -> s3_checkin 토글로 게이팅
    if(!((cfg.stages||{})[gateStage]))return false;
    if(!((cfg.sources||{})[normSource(bk.source)]))return false;
  }
  const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+stage;
  if(fbGet('app/mailLogs/'+logKey))return false;
  // 템플릿 매칭(2026-07-25 클라라): 자동발송이 mailConfig/auto/{stage}.template로 다른 템플릿을 지정할 수 있다.
  // 지정 템플릿이 삭제·부재면 단계 기본 템플릿으로 폴백. dedupe(logKey)는 템플릿 무관하게 단계 기준 유지.
  const tpl=fbGet('app/mailTemplates/'+(tplKey||stage))||(tplKey?fbGet('app/mailTemplates/'+stage):null);
  if(!tpl||!tpl.subject)return false;
  // room: 문자열(단일) 또는 배열(멀티룸 몰아보내기 — 같은 게스트 방 여러 개를 1통에)
  const roomList=Array.isArray(room)?room.map(String):(room?[String(room)]:[]);
  const rData={};roomList.forEach(n=>{rData[n]=fbGet('app/rooms/'+n)||{};});
  const fill=s=>fillTpl_(s,bk,roomList,rData);
  try{
    var __to = guestRecipients_(bk);   // 특이사항 추가 이메일 포함
    var __subject = fill(tpl.subject);
    var __ko = (tpl.bodyKo && String(tpl.bodyKo).trim()) ? fill(tpl.bodyKo) : '';
    var __en = (tpl.bodyEn && String(tpl.bodyEn).trim()) ? fill(tpl.bodyEn) : '';
    if(__ko || __en){
      if(__ko) sendMail(__to, __subject, __ko);
      if(__en) sendMail(__to, __subject, __en);
    } else {
      var __body = (tpl.body && String(tpl.body).trim()) ? fill(tpl.body) : '';
      if(__body) sendMail(__to, __subject, __body);
    }
    fbSet('app/mailLogs/'+logKey,{stage,time:todayKST()+' '+nowHM(),email:__to,guest:bk.guest,room:roomList.join(',')});
    return true;
  }catch(err){
    GmailApp.sendEmail(ADMIN_EMAIL,'[PW] '+stage+' 발송 실패: '+bk.guest,String(err));
    return false;
  }
}

function reviewGuideFor(source){
  const k=normSource(source);
  if(k==='booking')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Booking.com app or website → Bookings → select Paradise Walk Residence → "Review your stay"\n(Booking.com will also send you a review invitation by email — either way works!)';
  if(k==='agoda')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Agoda app → My Bookings → select Paradise Walk Residence → "Write a review"\n(Agoda will also send you a review invitation — either way works!)';
  if(k==='expedia')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Expedia or Hotels.com app → Trips → select Paradise Walk Residence → "Write a review"';
  return '';
}

function sendByDate(stage,dateField,targetDate,tplKey){
  const pend=fbGet('app/pendingBookings')||{};let n=0;
  for(const bk of Object.values(pend)){
    if(!bk||bk.cancelled)continue;
    if(bk[dateField]!==targetDate)continue;
    if(sendStageMail(stage,bk,null,false,tplKey))n++;
  }
  return n;
}
// 방문고지(s5) 전용 — 객실이 이미 '퇴실완료(checkout_done)'면 발송 skip
function sendS5Visit(tplKey){
  const today=todayKST();
  const pend=fbGet('app/pendingBookings')||{};
  const rooms=fbGet('app/rooms')||{};
  // bookingId → 방번호 매핑 (현재 그 방에 든 예약 기준)
  const bidToRoom={};
  for(const num of Object.keys(rooms)){
    const r=rooms[num]; if(!r) continue;
    const cb=r.currentBooking;
    if(cb&&cb.bookingId) bidToRoom[String(cb.bookingId)]=num;
  }
  let n=0;
  for(const bk of Object.values(pend)){
    if(!bk||bk.cancelled)continue;
    if(bk.checkoutDate!==today)continue;        // 오늘 체크아웃 대상
    // 이 예약이 들어있는 방 찾기 → 그 방이 퇴실완료면 skip
    const room=bk.bookingId?bidToRoom[String(bk.bookingId)]:null;
    if(room && rooms[room] && rooms[room].status==='checkout_done') continue;  // ★ 퇴실완료 제외
    if(sendStageMail('s5_checkoutConfirm',bk,null,false,tplKey))n++;
  }
  return n;
}
// ============================================================
// 마스터 틱 — 5분마다
// ============================================================
// 자동발송 시간·템플릿 설정(2026-07-25 클라라): app/mailConfig/auto/{stage} = {time:'HH:MM', template:'커스텀키'}
// 미설정이면 기존 하드코딩 시각·단계 기본 템플릿 그대로 = 완전 하위호환. on/off는 기존 mailConfig/stages 토글.
// 발송창 = 설정 시각부터 2시간 + "오늘 이미 돌았나" 도장(app/autoSend/lastRun/{stage}).
// 2026-07-29: 10분 창은 5분 트리거가 몇 분만 밀려도 통째로 건너뛰어 그날 발송이 통으로 날아갔다
// (방문고지 미발송 실사고). 도장 방식이면 밀려도 다음 틱이 잡고, 하루 1회는 도장이 보장한다.
// 중복은 mailLogs(예약+단계) 가드가 이중으로 막는다.
const AUTO_SEND_DEF={s2_reminder:420,s5_checkoutConfirm:665,s6_review:750,s4_checkout:1260};
function autoSendWin_(auto,stage,min){      // 발송창 판정만 — 도장은 runAuto_가 발송 성공 뒤에 찍는다
  const c=auto&&auto[stage];let m=AUTO_SEND_DEF[stage];
  if(c&&c.time&&/^\d{1,2}:\d{2}$/.test(String(c.time))){const p=String(c.time).split(':');m=(+p[0])*60+(+p[1]);}
  if(min<m||min>=m+120)return false;          // 설정 시각~+2시간. 상한은 한밤중 뒷북 발송 방지
  return fbGet('app/autoSend/lastRun/'+stage)!==todayKST();   // 오늘 이미 돌았으면 skip
}
// 2026-08-01: 도장을 발송 '전'에 찍던 구조 — 발송이 던지거나 6분 실행한도로 죽으면
// 도장만 남아 그날 발송이 통째로 날아갔다(다음 틱이 "오늘 이미 돌았음"으로 판단). 이제 성공 뒤에만 찍는다.
// 실패하면 도장이 없으니 다음 틱(5분)이 창 안에서 재시도, 중복은 mailLogs(예약+단계)가 막는다.
function runAuto_(auto,stage,min,fn){
  if(!autoSendWin_(auto,stage,min))return;
  try{ fn(); fbSet('app/autoSend/lastRun/'+stage,todayKST()); }
  catch(err){ GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 자동발송 실패 '+stage+' — 다음 틱 재시도',String(err)); }
}
function masterTick(){
  const min=nowMinKST();
  try{ if(min>=719) rotateDueBookings_(true); }catch(e){}   // 11:59 턴오버 누락분 자가 복구
  try{ promoteVacantArrivals_(); }catch(e){}   // 공실 방 당일예약 승격 — 매 틱, 창·시각 무관 무조건
  const auto=fbGet('app/mailConfig/auto')||{};
  const tplOf=s=>(auto[s]&&auto[s].template)||null;
  runAuto_(auto,'s2_reminder',min,()=>sendByDate('s2_reminder','checkinDate',kstDate(1),tplOf('s2_reminder')));   // 기본 07:00 (KST)
  runAuto_(auto,'s5_checkoutConfirm',min,()=>sendS5Visit(tplOf('s5_checkoutConfirm')));                            // 기본 11:05
  runAuto_(auto,'s6_review',min,()=>sendByDate('s6_review','checkoutDate',kstDate(-1),tplOf('s6_review')));        // 기본 12:30
  runAuto_(auto,'s4_checkout',min,()=>sendByDate('s4_checkout','checkoutDate',kstDate(1),tplOf('s4_checkout')));   // 기본 21:00

  // ★ 입실안내(s3) — 시각 기반: 매 틱마다 발송창에 든 방을 발송 (승인흐름 제거)
  const mode=fbGet('app/config/sendMode')||'manual';
  if(mode==='auto'){
    sendCheckinDue();                       // 자동: 시각기반 발송
  } else if(mode==='approve'){
    // 승인모드(레거시): 14:30대 하루 1회 승인메일
    if(min>=870&&min<900){
      const asked=fbGet('app/autoSend/approvalAskedDate');
      if(asked!==todayKST()){fbSet('app/autoSend/approvalAskedDate',todayKST());sendApprovalEmail();}
    }
  }
  // mode==='manual' → 아무것도 안 함 (수동 발송만)
  try{ latePrepTick_(); }catch(e){}      // 늦은 객실준비 안내 (15:10+, 입실안내 미발송 방 게스트에게 1회)
  // 금액 동기화는 틱 맨 뒤(자동발송 뒤) — f357185에서 '맨 뒤로 옮긴다'며 지운 뒤 재삽입이 빠져 틱에서 아예 안 돌던 것 복원 (2026-09-18)
  try{ syncAmounts(); }catch(e){}
  }


// ============================================================
// 원탭 자동 업데이트 (2026-09-04) — 레포 최신 Code.gs를 GAS가 스스로 가져와 갱신+재배포.
// 1회 설정(컴퓨터): ① https://script.google.com/home/usersettings 에서 Google Apps Script API 켜기
//   ② 이 파일 붙여넣기+저장 ③ 프로젝트 설정→'appsscript.json 매니페스트 표시' 체크 후
//      appsscript.json에 selfUpdateHelp() 로그의 oauthScopes 추가 ④ selfUpdate 1회 실행(권한 승인).
// 이후: <웹앱URL>?action=selfupdate&token=<APPROVE_TOKEN> 호출 한 번 = 코드 갱신+버전+재배포 완료.
// 갱신 소스는 아래 SELF_UPDATE_URL (정본 = main).
// ============================================================
var SELF_UPDATE_URL='https://raw.githubusercontent.com/pwr-clair/housekeeping/main/gas/Code.gs';

function selfUpdateRun(){Logger.log(selfUpdate());}   // 에디터 실행용 — 결과를 로그로 (selfUpdate는 반환값이라 에디터에선 안 보임)
function selfUpdateHelp(){
  Logger.log([
    '■ appsscript.json에 추가할 항목 (기존 timeZone 등은 그대로 두고 oauthScopes만 추가/교체):',
    '"oauthScopes": [',
    '  "https://mail.google.com/",',
    '  "https://www.googleapis.com/auth/script.external_request",',
    '  "https://www.googleapis.com/auth/script.scriptapp",',
    '  "https://www.googleapis.com/auth/script.projects",',
    '  "https://www.googleapis.com/auth/script.deployments"',
    '],',
    '■ 원탭 업데이트 URL: '+(ScriptApp.getService().getUrl()||'(웹앱 미배포)')+'?action=selfupdate&token=(APPROVE_TOKEN 값)'
  ].join('\n'));
}

function selfUpdate(){
  var sid=ScriptApp.getScriptId(), H={Authorization:'Bearer '+ScriptApp.getOAuthToken()};
  // 1) 레포에서 새 코드 (캐시 우회) + 안전 검증 — 비정상이면 아무것도 안 바꾼다
  var res=UrlFetchApp.fetch(SELF_UPDATE_URL+'?cb='+Date.now(),{muteHttpExceptions:true});
  if(res.getResponseCode()>=300)return '레포에서 코드를 못 가져옴: HTTP '+res.getResponseCode();
  var code=res.getContentText();
  if(!code||code.length<20000||code.indexOf('function masterTick')<0||code.indexOf('function doPost')<0)
    return '가져온 코드가 비정상(길이 '+(code?code.length:0)+') — 중단, 아무것도 안 바꿈';
  // 2) 현재 프로젝트 파일 읽기 (appsscript.json 등 다른 파일은 그대로 보존)
  var cur;
  try{cur=JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/'+sid+'/content',{headers:H,muteHttpExceptions:true}).getContentText());}catch(e){cur={};}
  if(!cur.files)return '프로젝트 읽기 실패 — script.google.com/home/usersettings 에서 Apps Script API를 켰는지, 매니페스트 oauthScopes를 넣었는지 확인 (selfUpdateHelp 참조)';
  var found=false;
  cur.files.forEach(function(f){if(f.type==='SERVER_JS'&&f.name==='Code'){f.source=code;found=true;}});
  if(!found)return 'Code 파일을 못 찾음 — 중단';
  // 3) 코드 반영
  var up=UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/'+sid+'/content',
    {method:'put',contentType:'application/json',headers:H,payload:JSON.stringify({files:cur.files}),muteHttpExceptions:true});
  if(up.getResponseCode()>=300)return '코드 갱신 실패: '+up.getContentText().slice(0,300);
  // 4) 새 버전 생성 + 웹앱 배포 갱신 (URL 유지). 실패해도 트리거 함수는 이미 최신 — doGet/doPost만 수동 배포 필요.
  try{
    var ver=JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/'+sid+'/versions',
      {method:'post',contentType:'application/json',headers:H,
       payload:JSON.stringify({description:'selfUpdate '+todayKST()+' '+nowHM()}),muteHttpExceptions:true}).getContentText());
    if(!ver.versionNumber)throw new Error(JSON.stringify(ver).slice(0,200));
    var deps=JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/'+sid+'/deployments',{headers:H,muteHttpExceptions:true}).getContentText());
    var n=0;
    (deps.deployments||[]).forEach(function(d){
      var cfg=d.deploymentConfig||{};
      if(cfg.versionNumber==null)return;   // HEAD(테스트) 배포 제외
      var r2=UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/'+sid+'/deployments/'+d.deploymentId,
        {method:'put',contentType:'application/json',headers:H,
         payload:JSON.stringify({deploymentConfig:{scriptId:sid,versionNumber:ver.versionNumber,
           manifestFileName:cfg.manifestFileName||'appsscript',description:cfg.description||'selfUpdate'}}),
         muteHttpExceptions:true});
      if(r2.getResponseCode()<300)n++;
    });
    return '✅ 코드 갱신 + v'+ver.versionNumber+' 배포 '+n+'건 갱신 완료 ('+todayKST()+' '+nowHM()+')';
  }catch(e){
    return '✅ 코드는 갱신됨 / ⚠ 재배포 실패: '+String(e).slice(0,150)+' — doGet/doPost 변경분이 있으면 수동 배포 필요';
  }
}

// ============================================================
// 늦은 객실준비 안내 (2026-08-25 클라라) — 15:10에도 입실안내(s3)가 못 나간
// 오늘 체크인 방의 게스트에게 준비 지연 안내를 자동 발송. 게스트(이메일)당 하루 1회.
// 템플릿 = 커스텀 안내 템플릿 중 이름이 LATE_PREP_TPL과 정확히 일치. 없으면 스킵.
// 템플릿 이름을 바꾸면 이 상수도 같이 바꿔야 발송된다.
// {room}은 준비 안 된 방이라 {doorPw}는 치환하지 않는다(템플릿에 넣지 말 것).
// 수신자는 guestRecipients_ — 이메일 칸이 비어도 특이사항 속 주소로 나간다(9c1f79e 규약).
// ============================================================
var LATE_PREP_TPL='객실 준비 지연 안내';   // 템플릿 관리에 있는 이름과 글자 그대로 일치해야 함
function latePrepTick_(){
  var min=nowMinKST();
  if(min<910||min>=1080)return;   // 15:10~18:00 창
  var rooms=fbGet('app/rooms')||{}, sent=fbGet('app/sentChecks')||{}, today=todayKST();
  var groups={};
  for(var num in rooms){
    var r=rooms[num]; if(!r||r.blocked)continue;
    var cb=todayCheckinOf_(r,today); if(!cb)continue;
    var to=guestRecipients_(cb); if(!to)continue;
    if(sent[num+'_'+today])continue;   // 입실안내 이미 발송된 방 = 대상 아님
    var key=to.toLowerCase();
    (groups[key]=groups[key]||{guest:cb.guest,to:to,nums:[]}).nums.push(num);
  }
  var keys=Object.keys(groups); if(!keys.length)return;
  var tpls=fbGet('app/mailTemplates')||{}, tpl=null;
  for(var k in tpls){
    // 템플릿 이름은 운영 중인 정확한 이름 하나로 고정 (2026-09-19 클라라 지시)
    if(k.indexOf('custom_')===0&&tpls[k]&&String(tpls[k].name||'').trim()===LATE_PREP_TPL){tpl=tpls[k];break;}
  }
  if(!tpl){Logger.log('latePrepTick_: 커스텀 템플릿 "'+LATE_PREP_TPL+'" 없음 — 스킵');return;}
  keys.forEach(function(kk){
    var g=groups[kk];
    var logKey='late_prep_'+kk.replace(/[.#$\[\]\/]/g,'_')+'_'+today;
    if(fbGet('app/mailLogs/'+logKey))return;   // 게스트당 하루 1회
    var roomLabel=g.nums.sort().join(', ');
    var fill=function(s){return String(s||'')
      .replace(/{guest}/g,g.guest||'Guest').replace(/{room}/g,roomLabel)
      .replace(/{floor}/g,g.nums.map(floorOf).join(', ')).replace(/{checkinDate}/g,today);};
    var subject=fill(tpl.subject)||('Room Preparation Delay / 객실 준비 지연 안내 — Paradise Walk Residence');
    try{
      if(tpl.bodyKo&&String(tpl.bodyKo).trim())sendMail(g.to,subject,fill(tpl.bodyKo));
      if(tpl.bodyEn&&String(tpl.bodyEn).trim())sendMail(g.to,subject,fill(tpl.bodyEn));
      fbSet('app/mailLogs/'+logKey,{stage:'late_prep',time:today+' '+nowHM(),email:g.to,guest:g.guest,room:roomLabel});
      Logger.log('latePrepTick_: '+roomLabel+'호 '+g.guest+' 지연 안내 발송');
    }catch(e){
      GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 지연안내 발송 실패: '+g.guest,String(e));
    }
  });
}

// ============================================================
// 입실안내 — 발송 시각 도달 판정
// 기본 14:30부터. 얼리체크인(2026-08-23 클라라): ETA(checkinTime)가 이르면
// '입실 1시간 전'부터 발송 허용 — 단 정오(12:00) 이전으로는 안 내려감(오전 발송 금지),
// 기본창(14:30)보다 늦춰지지도 않음. 청소완료·당일입실 조건은 findCheckinDue가 이미 강제.
// ============================================================
function checkinDueNow(cb){
  var nowMin = parseInt(Utilities.formatDate(new Date(),'Asia/Seoul','HH'),10)*60
             + parseInt(Utilities.formatDate(new Date(),'Asia/Seoul','mm'),10);
  var due = 870;   // 기본 14:30
  var ci = etaStart((cb&&cb.checkinTime)||'');
  if(ci){
    var m = parseInt(ci.slice(0,2),10)*60 + parseInt(ci.slice(3,5),10);
    // 새벽대(00:00~05:59) ETA = 자정 넘긴 심야 도착 — 얼리 아님, 기본창 유지 (2026-08-23 클라라)
    if(m >= 360) due = Math.min(870, Math.max(720, m-60));
  }
  return nowMin >= due;
}

// 방의 오늘 체크인 예약 탐색: currentBooking 우선, 없으면 nextBookings까지 (수동 sendRoom과 동일 —
// 공실 하루 이상 후 체크인은 11:59 승격 대상이 아니라 nextBookings에 머무름)
function todayCheckinOf_(r,today){
  if(r.currentBooking&&r.currentBooking.guest&&r.currentBooking.checkinDate===today)return r.currentBooking;
  const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
  return nexts.find(b=>b&&b.guest&&b.checkinDate===today)||null;
}

// 같은 게스트(이메일)의 오늘 체크인 방 전부 (멀티룸 몰아보내기 그룹, 2026-07-15 클라라)
function sameGuestRooms_(email,today,roomsAll){
  const g=[];
  if(!email)return g;
  for(const rn of Object.keys(roomsAll)){
    const ro=roomsAll[rn];if(!ro||ro.blocked)continue;
    const ob=todayCheckinOf_(ro,today);
    if(ob&&guestRecipients_(ob).toLowerCase()===String(email).toLowerCase())g.push(rn);
  }
  return g.sort();
}

// 템플릿 치환 — roomList가 2개 이상이면 {doorPw}가 든 문단(▶ Room Access 블록)을
// 방 수만큼 반복해 한 통에 담는다(클라라 확정 레이아웃 2026-07-15). 나머지 문단은 방번호 나열.
function fillTpl_(s,bk,roomList,rData){
  s=String(s||'')
    .replace(/{guest}/g,bk.guest||'Guest').replace(/{checkinDate}/g,bk.checkinDate||'')
    .replace(/{checkoutDate}/g,bk.checkoutDate||'')
    .replace(/{reviewGuide}/g,reviewGuideFor(bk.source));
  const fillRoom=(t,n)=>t.replace(/{room}/g,n).replace(/{floor}/g,floorOf(n)).replace(/{doorPw}/g,(rData[n]&&rData[n].doorPw)||'');
  if(roomList.length<=1)return roomList.length?fillRoom(s,roomList[0]):s.replace(/{room}/g,'').replace(/{floor}/g,'').replace(/{doorPw}/g,'');
  const roomLabel=roomList.join(', ');
  const floorLabel=[...new Set(roomList.map(floorOf))].join(', ');
  return s.split(/\n[ \t]*\n/).map(p=>
    /\{doorPw\}/.test(p)?roomList.map(n=>fillRoom(p,n)).join('\n\n')
      :p.replace(/{room}/g,roomLabel).replace(/{floor}/g,floorLabel).replace(/{doorPw}/g,'')
  ).join('\n\n');
}

function findCheckinDue(){
  // 게스트(이메일) 단위 그룹 반환 — 멀티룸이면 nums 여러 개를 1통에 몰아보냄 (2026-07-15 클라라).
  const rooms=fbGet('app/rooms')||{},sent=fbGet('app/sentChecks')||{},today=todayKST();
  const groups={};
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    const cb=todayCheckinOf_(r,today);
    if(!cb||!guestRecipients_(cb))continue;
    const key=guestRecipients_(cb).toLowerCase();
    (groups[key]=groups[key]||[]).push({num,r,cb});
  }
  const due=[];
  for(const key of Object.keys(groups)){
    const g=groups[key];
    if(g.some(x=>sent[x.num+'_'+today]))continue;      // 그룹 내 기발송 → 전체 스킵 (재발송 방지)
    if(g.some(x=>x.r.status!=='clean_done'))continue;  // ★ 전 방 청소완료 필수 — 부분 준비 발송 금지 (클라라: 필수 중의 필수)
    if(!checkinDueNow(g[0].cb))continue;               // ★ 발송 시각 창에 들었나
    due.push({nums:g.map(x=>x.num).sort(),cb:g[0].cb});
  }
  return due;
}

function sendCheckinDue(){
  const due=findCheckinDue(),today=todayKST();let count=0;
  for(const {nums,cb} of due){
    const bk={bookingId:cb.bookingId||('room_'+nums[0]+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,nums.length>1?nums:nums[0],false)){
      nums.forEach(n=>fbSet('app/sentChecks/'+n+'_'+today,today));  // 전 방 발송 마크(초록)
      count++;
    }
  }
  return count;
}

// 승인메일용 — 오늘 발송 대기 목록 (시각 무관, 참고용)
function findEligible(){
  const rooms=fbGet('app/rooms')||{},sent=fbGet('app/sentChecks')||{},today=todayKST();
  const eligible=[],noEmail=[],notReady=[];
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    const cb=r.currentBooking;if(!cb||!cb.guest)continue;
    if(cb.checkinDate!==today)continue;
    if(sent[num+'_'+today])continue;
    if(r.status!=='clean_done'){notReady.push({num,r});continue;}
    if(!guestRecipients_(cb)){noEmail.push({num,r});continue;}
    eligible.push({num,r});
  }
  return {eligible,noEmail,notReady};
}

function sendEligible(){
  // 승인 버튼용 — 지금 청소완료된 모든 미발송 입실안내 즉시 발송 (시각 무관)
  const {eligible}=findEligible();const today=todayKST();let count=0;
  for(const {num,r} of eligible){
    const cb=r.currentBooking;
    const bk={bookingId:cb.bookingId||('room_'+num+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,num,false)){fbSet('app/sentChecks/'+num+'_'+today,today);count++;}
  }
  return count;
}

function sendApprovalEmail(){
  const {eligible,noEmail,notReady}=findEligible();
  const url=ScriptApp.getService().getUrl();
  let body='오늘('+todayKST()+') 입실안내 발송 대기 목록\n\n';
  if(eligible.length===0)body+='— 발송 대상 없음\n';
  for(const {num,r} of eligible)body+='[발송예정] '+num+'호 | '+r.currentBooking.guest+' | '+(r.currentBooking.source||'?')+' | 비번 '+(r.doorPw||'미설정')+'\n';
  for(const {num,r} of notReady)body+='[청소중] '+num+'호 | '+r.currentBooking.guest+' → 청소완료 후 발송\n';
  for(const {num,r} of noEmail)body+='[이메일없음] '+num+'호 | '+r.currentBooking.guest+'\n';
  if(eligible.length>0)body+='\n▼ 클릭 시 [발송예정] 전체 즉시 발송\n'+url+'?action=approve&token='+APPROVE_TOKEN;
  GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 입실안내 승인 요청 ('+eligible.length+'건)',body);
}

// ============================================================
// 외부 요청 (승인 링크 / 수동 발송)
// ============================================================
function doGet(e){
  const p=e.parameter||{};
  if(p.token!==APPROVE_TOKEN)return ContentService.createTextOutput('Paradise Walk GAS 작동 중');
  if(p.action==='approve'){
    return ContentService.createTextOutput('발송 완료: '+sendEligible()+'건');
  }
  if(p.action==='selfupdate'){   // 원탭 자동 업데이트 (2026-09-04) — 레포 최신 코드로 갱신+재배포
    return ContentService.createTextOutput(selfUpdate());
  }
  if(p.action==='sendRoom'&&p.room){
    const num=String(p.room),today=todayKST();
    const r=fbGet('app/rooms/'+num);
    if(!r)return ContentService.createTextOutput(num+'호: 객실 정보 없음');
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return ContentService.createTextOutput(num+'호: 오늘 체크인 예약이 없어요');
    if(!guestRecipients_(cb))return ContentService.createTextOutput(num+'호: 손님 이메일이 없어요');
    const logKey=String(cb.bookingId||('room_'+num+'_'+today)).replace(/[.#$\[\]\/]/g,'_')+'_s3_checkin';
    let sendTarget=num,markNums=[num];
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);fbDelete('app/sentChecks/'+num+'_'+today);}
    else{
      if(fbGet('app/sentChecks/'+num+'_'+today))return ContentService.createTextOutput(num+'호: 이미 발송됨 (재발송 버튼 사용)');
      // 멀티룸(2026-07-15 클라라): 같은 게스트 타방 기발송이면 차단, 미발송이면 전 방을 1통에 몰아 발송
      const g=sameGuestRooms_(guestRecipients_(cb),today,fbGet('app/rooms')||{});
      const sentAll=fbGet('app/sentChecks')||{};
      const sentOther=g.find(rn=>rn!==num&&sentAll[rn+'_'+today]);
      if(sentOther)return ContentService.createTextOutput(num+'호: 같은 게스트에게 '+sentOther+'호(함께)로 이미 발송됨 (재발송 버튼 사용)');
      if(g.length>1){sendTarget=g;markNums=g;}
    }
    const bk={bookingId:cb.bookingId||('room_'+num+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,sendTarget,true)){
      markNums.forEach(n=>fbSet('app/sentChecks/'+n+'_'+today,today));
      return ContentService.createTextOutput('✅ '+markNums.join('·')+'호 '+cb.guest+'님께 발송 완료'+(markNums.length>1?' (1통 몰아보내기)':''));
    }
    return ContentService.createTextOutput(num+'호: 발송 실패');
  }
  if(p.action==='previewRoom'&&p.room){
    const num=String(p.room),today=todayKST();
    const r=fbGet('app/rooms/'+num);
    if(!r)return jsonOut({ok:false,msg:num+'호: 객실 정보 없음'});
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return jsonOut({ok:false,msg:num+'호: 오늘 체크인 예약이 없어요'});
    if(!guestRecipients_(cb))return jsonOut({ok:false,msg:num+'호: 손님 이메일이 없어요'});
    const nights=(cb.checkinDate&&cb.checkoutDate)?Math.round((new Date(cb.checkoutDate)-new Date(cb.checkinDate))/86400000):null;
    const stage=(nights===1)?'s34_combined':'s3_checkin';
    const tpl=fbGet('app/mailTemplates/'+stage)||{};
    // 멀티룸(2026-07-15): 같은 게스트 방 전부의 Room Access 블록을 미리보기에도 몰아서 표시
    const roomsAll=fbGet('app/rooms')||{};
    const g=sameGuestRooms_(guestRecipients_(cb),today,roomsAll);
    const roomList=g.length>1?g:[num];
    const rData={};roomList.forEach(n=>{rData[n]=roomsAll[n]||{};});
    const sentAll=fbGet('app/sentChecks')||{};
    const fill=s=>fillTpl_(s,cb,roomList,rData);
    return jsonOut({
      ok:true,room:roomList.join(', '),guest:cb.guest,stage:stage,
      alreadySent:roomList.some(n=>!!sentAll[n+'_'+today]),
      subject:fill(tpl.subject||''),
      bodyKo:fill(tpl.bodyKo||(tpl.bodyEn?'':tpl.body||'')),
      bodyEn:fill(tpl.bodyEn||'')
    });
  }
  if(p.action==='sendRoomEdited'&&p.room){
    // [패치 2026-08-23] 중복요청 가드: 락으로 동시 요청 직렬화 + '이미 발송됨' 판정을 편집본 확인보다 먼저.
    //   (기존엔 겹친 요청이 둘 다 발송돼 같은 메일 2통 + 뒤늦은 요청은 "편집 내용이 없어요"로 오인 표시)
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(30000))return ContentService.createTextOutput('다른 발송이 처리 중이에요 — 잠시 후 발송 기록을 확인해주세요');
    try{
    const num=String(p.room),today=todayKST();
    const r=fbGet('app/rooms/'+num);
    if(!r)return ContentService.createTextOutput(num+'호: 객실 정보 없음');
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return ContentService.createTextOutput(num+'호: 오늘 체크인 예약이 없어요');
    if(!guestRecipients_(cb))return ContentService.createTextOutput(num+'호: 손님 이메일이 없어요');
    const nights=(cb.checkinDate&&cb.checkoutDate)?Math.round((new Date(cb.checkoutDate)-new Date(cb.checkinDate))/86400000):null;
    const stg=(nights===1)?'s34_combined':'s3_checkin';
    const logKey=String(cb.bookingId||('room_'+num+'_'+today)).replace(/[.#$\[\]\/]/g,'_')+'_'+stg;
    let markNums=[num];
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);fbDelete('app/sentChecks/'+num+'_'+today);}
    else{
      if(fbGet('app/sentChecks/'+num+'_'+today))return ContentService.createTextOutput(num+'호: 이미 발송 완료된 건이에요 (재발송은 경고창 확인 후)');
      // 멀티룸(2026-07-15 클라라): 타방 기발송 차단 + 발송 성공 시 그룹 전 방 마크
      // (미리보기가 그룹 몰아보기 본문을 생성하므로 편집본도 전 방 안내를 담고 있음)
      const g=sameGuestRooms_(guestRecipients_(cb),today,fbGet('app/rooms')||{});
      const sentAll=fbGet('app/sentChecks')||{};
      const sentOther=g.find(rn=>rn!==num&&sentAll[rn+'_'+today]);
      if(sentOther)return ContentService.createTextOutput(num+'호: 같은 게스트에게 '+sentOther+'호(함께)로 이미 발송됨 (재발송 버튼 사용)');
      if(g.length>1)markNums=g;
    }
    const ov=fbGet('app/sendOverrides/'+num+'_'+today);
    if(!ov||(!ov.bodyKo&&!ov.bodyEn))return ContentService.createTextOutput(num+'호: 편집 내용이 없어요 — 발송창을 다시 열어주세요');
    try{
      // 제목: 편집창에서 일부러 비우면 빈 제목 그대로 발송. 기본 제목은 편집값이 아예 없을 때만.
      const subject=(ov.subject==null)?('Check-in Info / 체크인 안내 — Room '+num):String(ov.subject);
      const __to=guestRecipients_(cb);   // 특이사항 추가 이메일 포함
      if(ov.bodyKo && String(ov.bodyKo).trim())sendMail(__to,subject,ov.bodyKo);
      if(ov.bodyEn && String(ov.bodyEn).trim())sendMail(__to,subject,ov.bodyEn);
      fbSet('app/mailLogs/'+logKey,{stage:stg,time:todayKST()+' '+nowHM(),email:__to,guest:cb.guest,room:markNums.join(','),edited:true});
      markNums.forEach(n=>fbSet('app/sentChecks/'+n+'_'+today,today));
      fbDelete('app/sendOverrides/'+num+'_'+today);
      return ContentService.createTextOutput('✅ '+markNums.join('·')+'호 '+cb.guest+'님께 발송 완료 (편집본)');
    }catch(err){
      GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 편집발송 실패: '+cb.guest,String(err));
      return ContentService.createTextOutput(num+'호: 발송 실패');
    }
    }finally{lock.releaseLock();}
  }
  if(p.action==='previewStage'&&p.stage){
    // [패치 2026-07-14] custom_* 단계 허용 — 발송탭 [안내] 커스텀 템플릿 미리보기
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    const isCustom=String(p.stage).indexOf('custom_')===0;
    if(!isCustom&&ALLOW.indexOf(p.stage)<0)return jsonOut({ok:false,msg:'지원하지 않는 단계예요'});
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return jsonOut({ok:false,msg:'예약을 찾지 못했어요'});
    // 둘 다 적용: 방 데이터 이메일로 먼저 보강(roomEmailFor_, 2026-08-23) → 특이사항 속 주소까지 포함해 판정(guestRecipients_, 9c1f79e)
    if(!bk.guestEmail){const _re=roomEmailFor_(bk,room);if(_re)bk.guestEmail=_re;}
    if(!guestRecipients_(bk))return jsonOut({ok:false,msg:'손님 이메일이 없어요'});
    const nights=(bk.checkinDate&&bk.checkoutDate)?Math.round((new Date(bk.checkoutDate)-new Date(bk.checkinDate))/86400000):null;
    if(p.stage==='s4_checkout'&&nights===1)return jsonOut({ok:false,msg:'1박 예약은 퇴실안내가 입실안내에 포함돼요'});
    const r2=room?(fbGet('app/rooms/'+room)||{}):{};
    const tpl=fbGet('app/mailTemplates/'+p.stage)||{};
    if(isCustom&&!tpl.subject&&!tpl.bodyKo&&!tpl.bodyEn)return jsonOut({ok:false,msg:'템플릿이 없어요 — [템플릿 관리]에서 만들어주세요'});
    const fill=s=>String(s||'')
      .replace(/{guest}/g,bk.guest||'Guest').replace(/{checkinDate}/g,bk.checkinDate||'')
      .replace(/{checkoutDate}/g,bk.checkoutDate||'').replace(/{room}/g,room||'')
      .replace(/{floor}/g,room?floorOf(room):'').replace(/{doorPw}/g,r2.doorPw||'')
      .replace(/{reviewGuide}/g,reviewGuideFor(bk.source));
    const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+p.stage;
    return jsonOut({
      ok:true,stage:p.stage,guest:bk.guest,bid:p.bid||'',room:room||'',
      alreadySent:!!fbGet('app/mailLogs/'+logKey),
      subject:fill(tpl.subject||''),
      bodyKo:fill(tpl.bodyKo||(tpl.bodyEn?'':tpl.body||'')),
      bodyEn:fill(tpl.bodyEn||'')
    });
  }
  if(p.action==='sendStageEdited'&&p.stage){
    // [패치 2026-07-14] custom_* 단계 허용 — 발송탭 [안내] 커스텀 템플릿 발송(편집본)
    // [패치 2026-08-23] 중복요청 가드(sendRoomEdited와 동일): 락 + '이미 발송됨' 판정을 편집본 확인보다 먼저.
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    const isCustom=String(p.stage).indexOf('custom_')===0;
    if(!isCustom&&ALLOW.indexOf(p.stage)<0)return ContentService.createTextOutput('지원하지 않는 단계예요');
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(30000))return ContentService.createTextOutput('다른 발송이 처리 중이에요 — 잠시 후 발송 기록을 확인해주세요');
    try{
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return ContentService.createTextOutput('예약을 찾지 못했어요');
    // 둘 다 적용: 방 데이터 이메일로 먼저 보강 → 특이사항 속 주소까지 포함해 판정
    if(!bk.guestEmail){const _re=roomEmailFor_(bk,room);if(_re)bk.guestEmail=_re;}
    if(!guestRecipients_(bk))return ContentService.createTextOutput('손님 이메일이 없어요');
    const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+p.stage;
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);}
    else if(fbGet('app/mailLogs/'+logKey))return ContentService.createTextOutput('이미 발송 완료된 건이에요 (재발송은 경고창 확인 후)');
    const ovKey='stage_'+(p.bid||p.room||'x')+'_'+p.stage;
    const ov=fbGet('app/sendOverrides/'+ovKey);
    if(!ov||(!ov.bodyKo&&!ov.bodyEn))return ContentService.createTextOutput('편집 내용이 없어요 — 발송창을 다시 열어주세요');
    try{
      const NAME={s2_reminder:'체크인 리마인더',s4_checkout:'퇴실 안내',s5_checkoutConfirm:'방문 고지',s6_review:'후기'};
      let label=NAME[p.stage];
      if(!label&&isCustom){const ct=fbGet('app/mailTemplates/'+p.stage)||{};label=ct.name||'안내';}
      // 제목: 편집창에서 일부러 비우면 빈 제목 그대로 발송(플랫폼 채팅에 제목 헤더 안 뜨게). 기본 제목은 편집값이 아예 없을 때만.
      const subject=(ov.subject==null)?((label||'안내')+' — Paradise Walk Residence'):String(ov.subject);
      const __to=guestRecipients_(bk);   // 특이사항 추가 이메일 포함
      if(ov.bodyKo && String(ov.bodyKo).trim())sendMail(__to,subject,ov.bodyKo);
      if(ov.bodyEn && String(ov.bodyEn).trim())sendMail(__to,subject,ov.bodyEn);
      fbSet('app/mailLogs/'+logKey,{stage:p.stage,time:todayKST()+' '+nowHM(),email:__to,guest:bk.guest,room:room||'',edited:true});
      fbDelete('app/sendOverrides/'+ovKey);
      return ContentService.createTextOutput('✅ '+bk.guest+'님께 ['+(label||p.stage)+'] 발송 완료 (편집본)');
    }catch(err){
      GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 편집발송 실패('+p.stage+'): '+bk.guest,String(err));
      return ContentService.createTextOutput('발송 실패');
    }
    }finally{lock.releaseLock();}
  }
  if(p.action==='waMirror'){
    // KR/EN 메신저 발송 시 같은 안내문을 OTA 채널(게스트 릴레이 이메일)로도 미러 발송 (2026-07-24 클라라).
    // 2차 개편(2026-07-24): 프런트가 confirm 대신 편집 가능한 발송창을 띄운다 —
    //   편집본은 app/sendOverrides/{logKey} {body}로 도착(사용 후 삭제), 재발송은 force=1(경고창 확인 후)로만 가드 해제.
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||''};
    }
    if(!bk)return ContentService.createTextOutput('예약을 찾지 못했어요');
    if(!guestRecipients_(bk))return ContentService.createTextOutput('이메일 없음');
    const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_waMirror';
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);}
    else if(fbGet('app/mailLogs/'+logKey))return ContentService.createTextOutput('이미 발송됨 — 다시 보내려면 초록 버튼을 다시 탭해 발송창에서 재발송');
    const lang=(p.lang==='ko')?'ko':'en';
    const wm=fbGet('app/waMessages')||{};
    const fallback=lang==='ko'
      ?'[Incheon Airport T1 Residence] 안녕하세요, 예약하신 플랫폼의 메시지로 체크인 안내를 보내드렸습니다. 확인 부탁드립니다. 문의: 010-8227-2845'
      :'[Incheon Airport T1 Residence] Hello, we\'ve sent your check-in details via your booking platform\'s message. Please check it. Contact: 010-8227-2845';
    const ov=fbGet('app/sendOverrides/'+logKey)||{};
    const body=(ov.body&&String(ov.body).trim())?ov.body:(wm[lang]||fallback);
    try{
      const __to=guestRecipients_(bk);   // 특이사항 추가 이메일 포함
      sendMail(__to,'',body);
      fbSet('app/mailLogs/'+logKey,{stage:'waMirror',time:todayKST()+' '+nowHM(),email:__to,guest:bk.guest,room:room||''});
      fbDelete('app/sendOverrides/'+logKey);
      return ContentService.createTextOutput('✅ '+bk.guest+'님께 OTA 채팅(이메일) 안내 발송 완료');
    }catch(err){
      return ContentService.createTextOutput('발송 실패: '+String(err));
    }
  }
  if(p.action==='sendStage'&&p.stage){
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    if(ALLOW.indexOf(p.stage)<0)return ContentService.createTextOutput('지원하지 않는 단계예요');
    const NAME={s2_reminder:'체크인 리마인더',s4_checkout:'퇴실 안내',s5_checkoutConfirm:'방문 고지',s6_review:'후기'};
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,notes:cb.notes||'',checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return ContentService.createTextOutput('예약을 찾지 못했어요');
    if(!guestRecipients_(bk))return ContentService.createTextOutput('손님 이메일이 없어요');
    const ok=sendStageMail(p.stage,bk,room,true);
    return ContentService.createTextOutput(ok?('✅ '+bk.guest+'님께 ['+NAME[p.stage]+'] 발송 완료'):'발송 안 됨 — 이미 발송됐거나 템플릿 오류');
  }
  return ContentService.createTextOutput('Paradise Walk GAS 작동 중');
}

// ============================================================
// 자동 전환
// ============================================================
function t1100_checkoutConfirm(){
  const rooms=fbGet('app/rooms')||{},today=todayKST();
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    const cb=r.currentBooking;
    if(cb&&cb.checkoutDate===today&&r.status==='checkin')fbUpdate('app/rooms/'+num,{status:'checkout_confirm'});
  }
}
function t1159_moveBookings(){
  const today=todayKST();
  const hist=fbGet('app/bookingHistory')||{},cutoff=kstDate(-7);
  for(const [key,h] of Object.entries(hist)){if(!h.checkoutDate||h.checkoutDate<cutoff)fbDelete('app/bookingHistory/'+key);}
  const pend=fbGet('app/pendingBookings')||{},pCutoff=kstDate(-3);
  for(const [key,bk] of Object.entries(pend)){if(bk&&bk.checkoutDate&&bk.checkoutDate<pCutoff)fbDelete('app/pendingBookings/'+key);}
  rotateDueBookings_();
  promoteVacantArrivals_();   // 턴오버 정리 후 공실 방 승격
}

// 턴오버(퇴실일 도래 현재예약 → 이력, 다음예약 승격). 멱등 — 이미 넘어간 방은 조건에 안 걸린다.
// masterTick이 11:59 이후 매 틱 재호출 → 11:59 트리거가 중간에 죽거나(UrlFetch 일시 오류는 muteHttpExceptions로 안 잡힘)
// 아예 안 돌아도 5분 내 자가 복구. 방 하나의 오류가 뒷방 전체를 막지 않도록 방별 try. (2026-09-19 1240·1236·1031·1037 미이동 건)
function rotateDueBookings_(keepStatus){
  const today=todayKST();
  for(const num of roomNums()){try{
    let r=fbGet('app/rooms/'+num);
    if(!r||r.blocked)continue;
    let guard=0;
    while(r.currentBooking&&r.currentBooking.guest&&r.currentBooking.checkoutDate&&r.currentBooking.checkoutDate<=today&&guard<10){
      guard++;
      const cb=r.currentBooking;
      const nextArr=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      fbSet('app/bookingHistory/h_'+Date.now()+'_'+num+'_'+guard,{room:num,guest:cb.guest,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate,source:cb.source||'',completedAt:today+' auto'});
      // 오전에 이미 청소중/청소완료 처리된 방은 상태 보존 — 정오 이동이 청소필요로 되돌리면 안 됨 (2026-07-15 클라라)
      // keepStatus(masterTick 사후 복구): 현장이 이미 작업 중일 수 있으니 상태는 절대 안 건드리고 예약만 올린다 (2026-09-19 클라라)
      const st=(keepStatus||['cleaning','clean_done'].includes(r.status))?r.status:'need_clean';
      if(nextArr.length>0&&nextArr[0].checkinDate&&nextArr[0].checkinDate<=today){
        r={...r,currentBooking:nextArr[0],nextBookings:nextArr.slice(1)};
        fbUpdate('app/rooms/'+num,{currentBooking:nextArr[0],nextBookings:nextArr.slice(1),status:st});
      }else{
        r={...r,currentBooking:null};
        fbUpdate('app/rooms/'+num,{currentBooking:null,nextBookings:nextArr,status:st});
      }
    }
  }catch(e){console.error('rotateDueBookings_ '+num+': '+e);}}
}

// 공실 방 승격 — 현재예약 없고 다음예약[0]이 오늘 이하 체크인이면 현재로 올림.
// masterTick(5분)에서도 호출 → 창 열림·트리거 타이밍과 무관하게 최대 5분 내 무조건 승격.
// status는 건드리지 않는다(청소완료 등 기존 상태 보존 — 리셋하면 발송·입실전환이 깨짐).
function promoteVacantArrivals_(){
  const rooms=fbGet('app/rooms')||{},today=todayKST();
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    if(r.currentBooking&&r.currentBooking.guest)continue;
    const nextArr=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
    if(nextArr.length>0&&nextArr[0].checkinDate&&nextArr[0].checkinDate<=today){
      fbUpdate('app/rooms/'+num,{currentBooking:nextArr[0],nextBookings:nextArr.slice(1)});
    }
  }
}
function t1200_statusFix(){
  const rooms=fbGet('app/rooms')||{};
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    if(['checkout_confirm','checkout_done'].includes(r.status)&&(!r.currentBooking||!r.currentBooking.guest))fbUpdate('app/rooms/'+num,{status:'need_clean'});
  }
}

// ============================================================
// 운영 스위치
// ============================================================
function pauseAllMails(){
  fbSet('app/mailConfig/stages',{s1_confirm:false,s2_reminder:false,s3_checkin:false,s4_checkout:false,s5_checkoutConfirm:false,s6_review:false});
  Logger.log('전체 메일 OFF');
}
function resumeAllMails(){
  fbSet('app/mailConfig/stages',{s1_confirm:false,s2_reminder:true,s3_checkin:true,s4_checkout:true,s5_checkoutConfirm:false,s6_review:false});
  Logger.log('메일 재개 (2·3·4 자동 ON / 5·6 수동 운영)');
}

// ============================================================
// 트리거 설치
// ============================================================
function setupTriggers(){
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAllEtaToRooms').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('masterTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('t1100_checkoutConfirm').timeBased().atHour(11).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('t1159_moveBookings').timeBased().atHour(11).nearMinute(45).everyDays(1).create();
  ScriptApp.newTrigger('t1200_statusFix').timeBased().atHour(12).nearMinute(15).everyDays(1).create();
  // autoCheckinTick 트리거는 2026-09-18 클라라 지시로 폐지 (자동 입실중 전환 금지)
  Logger.log('트리거 5개 설치 완료');
}
function setBcc(){fbSet('app/config/bccEmail','joi.hurricane@gmail.com');Logger.log('BCC 켜짐');}
function clearBcc(){fbDelete('app/config/bccEmail');Logger.log('BCC 꺼짐');}

// ============================================================
// 자동 입실중 전환 — 2026-09-18 클라라 지시로 폐지 (2026-09-21 main 복구)
// ============================================================
// 예전엔 21:00 이후 매시간, 오늘 체크인 + 입실안내 발송완료된 clean_done 객실을 checkin으로
// 자동 전환했다. 사람이 객실 상태를 확인하기 전에 전부 '입실중'으로 바꿔버려 폐지.
// 함수 본체는 비워 둔다 — GAS에 기존 트리거가 남아 있어도 아무 일도 하지 않게.
// setupTriggers()에서도 제외했다. 에디터 트리거 목록의 autoCheckinTick은 삭제할 것.
// ★ 이 폐지는 004e586(옆 브랜치)에만 있어 main 전문 배포 때마다 되살아났다. 같은 경로의 3번째 사고.
function autoCheckinTick(){
  return; // 폐지 — 아무 것도 하지 않음
}

// 폐지 전 마지막 실행이 바꿔 놓은 객실을 되돌리는 일회성 함수.
// 조건은 autoCheckinTick이 전환했던 것과 동일: 정비중 아님 + 그 날 체크인 + 입실안내 발송완료
// + status가 'checkin' → 'clean_done'으로 복원. 에디터에서 revertAutoCheckin 실행.
// date를 안 주면 오늘. 다른 날을 되돌리려면 revertAutoCheckin('2026-09-20') 형태로.
function revertAutoCheckin(date){
  date = (typeof date === 'string' && date) ? date : todayKST();
  const rooms=fbGet('app/rooms')||{};
  const sent=fbGet('app/sentChecks')||{};
  const reverted=[];
  for(const num of Object.keys(rooms)){
    const r=rooms[num];
    if(!r||r.blocked)continue;
    const cb=r.currentBooking;
    if(!cb||!cb.guest)continue;
    if(cb.checkinDate!==date)continue;
    if(!sent[num+'_'+date])continue;
    if(r.status!=='checkin')continue;
    fbUpdate('app/rooms/'+num,{status:'clean_done'});
    reverted.push(num);
  }
  const out='revertAutoCheckin('+date+'): '+reverted.length+'개 객실 checkin→clean_done: '+reverted.join(', ');
  Logger.log(out);
  return out;
}

// ============================================================
// 금액 동기화 — SIRVOY 알림메일에서 Total 추출해 pendingBookings에 저장
// ============================================================
// 알림메일 Total 문자열 → 원 정수. 서보이가 메일마다 EU식("135.000,00")과 US식("114,750.00")을 섞어 보낸다
// (2026-09-17 JONAN 26482가 US식이라 114원으로 들어간 사고). 끝이 [.,]+두 자리면 소수부로 떼고 나머지 숫자만 취한다.
function wonFromMailTotal_(str){
  var t = String(str||'').trim();
  var m = t.match(/^(.*)[.,](\d{2})$/);
  var n = parseInt((m ? m[1] : t).replace(/[^\d]/g,''), 10);
  return isNaN(n) ? null : n;
}

function parseSirvoyAmount_(bookingId){
  var baseId = String(bookingId).split('_')[0].trim();
  if(!baseId) return null;
  // sirvoy booking alert 라벨에서 우선 검색 (inbox 비워져도 라벨로 찾음)
  var q = 'label:"sirvoy booking alert" from:support@sirvoy.com subject:("Booking ' + baseId + ' Added to Sirvoy")';
  var threads = GmailApp.search(q, 0, 5);
  // 라벨에서 못 찾으면 라벨 없이 한 번 더 (안전망)
  if(!threads || threads.length===0){
    q = 'from:support@sirvoy.com subject:("Booking ' + baseId + ' Added to Sirvoy")';
    threads = GmailApp.search(q, 0, 5);
  }
  for(var t=0;t<threads.length;t++){
    var msgs = threads[t].getMessages();
    for(var m=0;m<msgs.length;m++){
      var subj = msgs[m].getSubject() || '';
      if(subj.indexOf('Booking ' + baseId + ' ') < 0) continue;
      if(subj.indexOf('Added to Sirvoy') < 0) continue;   // 취소메일 제외
      var body = msgs[m].getBody() || '';
      var mt = body.match(/Total<\/strong>\s*:\s*([\d.,]+)/i);
      if(!mt) mt = body.match(/Total\s*:\s*([\d.,]+)/i);
      if(mt && mt[1]){
        var won = wonFromMailTotal_(mt[1]);
        if(won !== null) return won;
      }
    }
  }
  return null;
}

function syncAmounts(){
  var pend = fbGet('app/pendingBookings') || {};
  var done = 0, tried = 0, notfound = 0, today = todayKST();
  for(var key in pend){
    var bk = pend[key];
    if(!bk || bk.cancelled) continue;
    // 1,000원 미만은 파싱 사고(US식 Total→소수부만 잡힘)라 미수집으로 보고 다시 채운다 (2026-09-17)
    if(bk.amount !== undefined && bk.amount !== null && bk.amount !== '' && Number(bk.amount) >= 1000) continue;
    // 2026-08-01: 직판 예약은 SIRVOY 알림메일이 아예 없어 영원히 "못 찾음"인데,
    // 이걸 5분마다 재검색하느라 Gmail 호출이 틱 실행시간을 먹고 뒤의 자동발송이 실행 한도에 잘렸다.
    // 한 예약당 하루 1회로 제한(오늘 늦게 도착한 메일은 내일 잡힌다).
    if(bk.amtMissAt === today) continue;
    tried++;
    if(tried > 20) break;   // 한 틱 최대 20건
    var won = parseSirvoyAmount_(bk.bookingId || key);
    if(won !== null){
      fbUpdate('app/pendingBookings/' + key, { amount: won });
      done++;
    } else {
      fbUpdate('app/pendingBookings/' + key, { amtMissAt: today });
      notfound++;
    }
  }
  return '시도 ' + tried + '건, 채움 ' + done + '건, 메일못찾음 ' + notfound + '건';
}

// ============================================================
// 이미 복제된 미배정 카드 청소 (2026-09-20) — 위 doPost 버그로 쌓인 쌍둥이 카드 일괄 삭제.
// 에디터에서 1회 실행하면 끝. 실행로그에 삭제·보류 목록이 찍힌다.
// 복제본 판별: 키가 '<기존키>_<방>' 꼴이고 그 <기존키>가 이미 방별 카드(bookingId에 '_')인 것.
// 방에 배정된 복제본은 지우지 않고 목록만 남긴다 — 어느 쪽이 살아있는 배정인지는 사람이 판단.
// ============================================================
// 복제/고아 카드 진단 (2026-09-20) — 읽기만 한다. 아무것도 바꾸지 않는다.
// ① 같은 bookingId에 카드가 2장 이상인 예약  ② 배정 표시는 있는데 실제로 그 예약이
// 들어 있는 방이 없는 '고아 카드'(객실 모달에서 예약만 지우면 카드가 이렇게 남는다).
// ============================================================
function dumpPendingDupes(){
  var pend=fbGet('app/pendingBookings')||{}, L=[], byBid={}, where=roomsByBookingId_(pend);
  Object.keys(pend).forEach(function(k){
    var bk=pend[k]; if(!bk)return;
    (byBid[String(bk.bookingId||'?')]=byBid[String(bk.bookingId||'?')]||[]).push(k);
  });
  L.push('■ 카드가 2장 이상인 예약 (복제 의심)');
  var dup=0;
  Object.keys(byBid).sort().forEach(function(bid){
    var ks=byBid[bid]; if(ks.length<2)return; dup++;
    L.push('  bookingId '+bid+' — 카드 '+ks.length+'장 / 실제 예약이 들어있는 방: '+((where[bid]||[]).join(', ')||'★ 없음'));
    ks.forEach(function(k){var b=pend[k];
      L.push('     '+k+'  배정표시='+(b.assignedRoom||'없음')+'  취소='+(b.cancelled?'Y':'N')+'  '+(b.guest||'')+'  '+(b.checkinDate||'')+'~'+(b.checkoutDate||''));});
  });
  if(!dup)L.push('  (없음)');
  // 퇴실한 예약은 방에서 빠지는 게 정상이라 제외 — 안 그러면 지난 손님이 전부 고아로 찍혀
  // 진짜 문제(아직 안 온 손님인데 방에 없음)가 묻힌다. (2026-09-20, 27건 중 25건이 정상이었음)
  var today=todayKST();
  L.push('■ 고아 카드 — 아직 퇴실 전인데 들어있는 방이 없음 (퇴실 완료분은 제외)');
  var orph=0;
  Object.keys(pend).forEach(function(k){
    var b=pend[k]; if(!b||b.cancelled)return;
    var asg=b.assignedRoom; if(!asg||asg==='manual')return;
    if(b.checkoutDate&&b.checkoutDate<=today)return;
    if((where[String(b.bookingId||'')]||[]).length)return;
    orph++;L.push('  '+k+'  배정표시='+asg+'호  '+(b.guest||'')+'  '+(b.checkinDate||'')+'~'+(b.checkoutDate||''));
  });
  if(!orph)L.push('  (없음)');
  var out=L.join('\n');Logger.log(out);return out;
}

// bookingId → 그 예약이 실제로 들어 있는 방 목록 (app/rooms 기준)
function roomsByBookingId_(){
  var rooms=fbGet('app/rooms')||{}, where={};
  Object.keys(rooms).forEach(function(n){
    var r=rooms[n]; if(!r)return;
    var cb=r.currentBooking;
    if(cb&&cb.bookingId)(where[String(cb.bookingId)]=where[String(cb.bookingId)]||[]).push(n+'호(현재)');
    var nx=Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{});
    nx.forEach(function(b){if(b&&b.bookingId)(where[String(b.bookingId)]=where[String(b.bookingId)]||[]).push(n+'호(예정)');});
  });
  return where;
}

// 다가오는 예약의 카드 현황 (2026-09-21) — 읽기 전용.
// 예약번호(bookingId의 '_' 앞부분)로 묶어서, 한 예약에 카드가 몇 장 붙어 있는지 보여준다.
// dumpPendingDupes는 bookingId가 '같은' 카드만 복제로 보는데, 멀티룸 방별 카드는
// bookingId가 '26500_501'이고 단일 카드는 '26500'이라 서로 달라 그 진단에 안 걸린다.
// 미배정에 유령 카드가 한 장 더 뜨는 건 대개 이 '단일+방별 혼재' 모양이다.
// ============================================================
function dumpUpcoming(){
  var pend=fbGet('app/pendingBookings')||{}, where=roomsByBookingId_(), today=todayKST(), g={}, L=[];
  Object.keys(pend).forEach(function(k){
    var b=pend[k]; if(!b)return;
    if(!b.checkinDate||b.checkinDate<today)return;              // 오늘 이후 체크인만
    var base=String(b.bookingId||'?').split('_')[0];
    (g[base]=g[base]||[]).push(k);
  });
  L.push('['+CODE_VER+']');
  L.push('오늘('+today+') 이후 체크인 예약 카드 — 예약번호별');
  var flagged=0;
  Object.keys(g).sort().forEach(function(base){
    var ks=g[base].sort(), single=0, perRoom=0;
    ks.forEach(function(k){ String(pend[k].bookingId||'').indexOf('_')<0 ? single++ : perRoom++; });
    var warn='';
    if(single>0&&perRoom>0) warn='   ★ 단일카드+방별카드 혼재 — 미배정에 유령 카드가 뜬다';
    else if(single>1)       warn='   ★ 단일카드가 '+single+'장';
    if(warn)flagged++;
    L.push('■ 예약 '+base+' — 카드 '+ks.length+'장 (단일 '+single+' / 방별 '+perRoom+')'+warn);
    ks.forEach(function(k){
      var b=pend[k];
      L.push('   '+k+'  bookingId='+b.bookingId+'  배정='+(b.assignedRoom||'없음')+
             '  취소='+(b.cancelled?'Y':'N')+'  '+(b.checkinDate||'')+'~'+(b.checkoutDate||'')+
             '  실제방='+((where[String(b.bookingId||'')]||[]).join(',')||'없음')+'  '+(b.guest||''));
    });
  });
  L.push(flagged?('★ 이상한 예약 '+flagged+'건'):'이상 없음');
  var out=L.join('\n'); Logger.log(out); return out;
}

// ============================================================
function cleanupDupePending(){
  var pend=fbGet('app/pendingBookings')||{}, L=[], mv=0, back=0, held=0, kill=[];
  var where=roomsByBookingId_();   // bookingId → 실제로 그 예약이 들어 있는 방
  // 판정은 원본 스냅샷으로 먼저 끝내고 삭제는 그 뒤에 — 3세대 복제본(sv_X_501_501_501)의
  // 부모를 도중에 지워버리면 판정이 어긋난다.
  Object.keys(pend).forEach(function(k){
    var bk=pend[k]; if(!bk)return;
    var cut=k.lastIndexOf('_'); if(cut<0)return;
    var baseBk=pend[k.slice(0,cut)];
    if(!baseBk||String(baseBk.bookingId||'').indexOf('_')<0)return;   // 원본(정본 방별 카드)은 건드리지 않음
    var asg=bk.assignedRoom;
    if(!asg||asg==='manual'){kill.push(k);L.push('삭제: '+k+'  '+(bk.guest||'')+'  '+(bk.checkinDate||''));return;}
    // 배정된 복제본 — 방 데이터(app/rooms)엔 이미 예약이 들어가 있으니 배정 자체는 건드리지 않고,
    // 카드의 배정 표시만 정본 카드('sv_'+bookingId)로 옮긴 뒤 복제본을 지운다.
    // 이걸 안 하면 정본 카드가 미배정으로 남아 배정탭에 '배정해야 할 예약'처럼 다시 뜬다.
    var canon='sv_'+String(bk.bookingId||'');
    if(!bk.bookingId||canon===k){held++;L.push('보류(정본 키를 못 찾음, 배정 '+asg+'호): '+k+'  '+(bk.guest||''));return;}
    // 카드에 적힌 배정('930호')을 믿지 않고 app/rooms가 실제로 그 예약을 담고 있는지 본다.
    // 객실 모달에서 예약만 지우면 카드의 배정 표시는 남아 거짓말을 한다 — 그걸 정본에 옮기면
    // 정본이 '배정됨'으로 숨겨져 미배정 목록에 영영 안 뜨고, 손님이 조용히 사라진다. (2026-09-20)
    var realRoom=(where[String(bk.bookingId)]||[])[0]||null;
    var c=pend[canon];
    if(!realRoom){
      if(!c)fbSet('app/pendingBookings/'+canon,{...bk,assignedRoom:null});
      else if(c.assignedRoom&&c.assignedRoom!=='manual'&&!(where[String(c.bookingId||'')]||[]).length)
        fbUpdate('app/pendingBookings/'+canon,{assignedRoom:null});
      kill.push(k);back++;
      L.push('미배정 복원 → '+canon+' (방에 실제 예약 없음, 복제본 '+k+' 삭제)  '+(bk.guest||'')+'  '+(bk.checkinDate||'')+'~'+(bk.checkoutDate||''));
      return;
    }
    var realNum=String(realRoom).replace(/호.*/,'');
    if(c&&c.assignedRoom&&c.assignedRoom!=='manual'&&String(c.assignedRoom)!==realNum){
      held++;L.push('보류(정본 '+canon+'은 '+c.assignedRoom+'호인데 실제는 '+realRoom+' — 사람이 판단): '+k+'  '+(bk.guest||''));return;
    }
    if(c)fbUpdate('app/pendingBookings/'+canon,{assignedRoom:realNum});
    else fbSet('app/pendingBookings/'+canon,{...bk,assignedRoom:realNum});
    kill.push(k);mv++;
    L.push('배정 이관 '+realRoom+' → '+canon+' (복제본 '+k+' 삭제)  '+(bk.guest||''));
  });
  kill.forEach(function(k){fbDelete('app/pendingBookings/'+k);});
  var out='['+CODE_VER+']\n복제 카드 삭제 '+(kill.length-mv-back)+'건, 배정 이관 '+mv+'건, 미배정 복원 '+back+'건, 보류 '+held+'건'+(L.length?'\n'+L.join('\n'):'');
  Logger.log(out);
  return out;
}

// ============================================================
// 자동발송 진단 — 에디터에서 checkAutoSend 실행 후 실행로그만 보면 된다 (발송은 안 한다)
// "방문고지가 왜 안 나갔나"를 한 화면에서 판정: 코드버전·트리거·토글·설정시각·대상별 사유
// ============================================================
function checkAutoSend(){
  const today=todayKST(), L=[];
  L.push('■ 코드버전 '+CODE_VER);
  L.push('■ 지금(KST) '+today+' '+nowHM());
  try{ L.push('트리거: '+ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();}).join(', ')); }
  catch(e){ L.push('트리거: 조회실패 '+e); }
  const lastRun=fbGet('app/autoSend/lastRun');
  L.push('코드버전: '+(lastRun?'07-29 이후(도장 방식) '+JSON.stringify(lastRun)
                              :'★ 구버전 — 07-29 수정본이 이 GAS에 안 들어가 있음(10분 창 그대로)'));
  const cfg=fbGet('app/mailConfig')||{}, stages=cfg.stages||{}, sources=cfg.sources||{}, auto=cfg.auto||{};
  L.push('방문고지 토글: '+(stages.s5_checkoutConfirm===true?'ON':'★ OFF — 자동발송 자체가 막힘'));
  L.push('방문고지 설정: '+JSON.stringify(auto.s5_checkoutConfirm||{})+'  (미설정이면 11:05)');
  L.push('채널 토글: '+JSON.stringify(sources));
  L.push('단계 토글: '+JSON.stringify(stages));
  const pend=fbGet('app/pendingBookings')||{}, rooms=fbGet('app/rooms')||{}, bidToRoom={};
  Object.keys(rooms).forEach(function(n){
    const cb=rooms[n]&&rooms[n].currentBooking; if(cb&&cb.bookingId)bidToRoom[String(cb.bookingId)]=n;
  });
  [0,-1].forEach(function(off){
    const d=kstDate(off); let cnt=0;
    L.push('■ '+d+' 체크아웃 = 방문고지 대상');
    Object.keys(pend).forEach(function(k){
      const bk=pend[k]; if(!bk||bk.cancelled||bk.checkoutDate!==d)return;
      cnt++;
      // 방 매핑: currentBooking이 이미 다음 예약으로 넘어간 방은 bidToRoom이 못 잡는다 → assignedRoom로 보완
      // (이게 없으면 정상 스킵된 퇴실완료 방이 '원인불명 미발송'으로 잘못 찍힌다)
      let room=bk.bookingId?bidToRoom[String(bk.bookingId)]:null;
      if(!room&&bk.assignedRoom&&bk.assignedRoom!=='manual'&&rooms[bk.assignedRoom])room=String(bk.assignedRoom);
      const log=bk.bookingId?fbGet('app/mailLogs/'+String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_s5_checkoutConfirm'):null;
      let why;
      if(log)why='O 발송됨 '+(log.time||'');
      else if(!guestRecipients_(bk))why='- 이메일 없음';
      else if(room&&rooms[room]&&rooms[room].status==='checkout_done')why='- 퇴실완료 방이라 제외';
      else if(stages.s5_checkoutConfirm!==true)why='★ 미발송 — 방문고지 토글 OFF';
      else if(sources[normSource(bk.source)]!==true)why='★ 미발송 — 채널 OFF('+normSource(bk.source)+')';
      else why='★ 미발송 — 발송창을 못 잡음(트리거·시각 확인)';
      L.push('  '+(room||bk.assignedRoom||'미배정')+'  '+(bk.guest||'')+'  '+why);
    });
    if(!cnt)L.push('  (대상 없음)');
  });
  const out=L.join('\n');
  Logger.log(out);
  return out;
}
