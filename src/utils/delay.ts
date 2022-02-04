export function delay(milliSeconds: number) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, milliSeconds);
    });
}

